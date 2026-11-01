/**
 * Roll back an applied repair run from its journal — exact inverse operations,
 * newest group first, each in its own SERIALIZABLE transaction under the same
 * locks apply took.
 *
 * Refuses (per group) unless the group's companies still hash to the recorded
 * after-state: a later edit, a new child, proposal, save, report, scan, binding
 * change or merge reference means a person has relied on the repaired state,
 * and overwriting it is not a rollback's call. A created company is removed
 * only once every reverse move succeeded and nothing new references it.
 *
 * History is kept: the journal rows stay (status ROLLED_BACK) and each
 * incumbent gets a REPAIR "reversed" revision.
 */
import { randomUUID } from 'node:crypto';

import { refreshDirectoryCounts } from '@repo/db';

import { GroupConflict, execute, journalHash, lockGroup, prismaShim, type InverseOp } from './apply';
import { RepairLock, writeSession, type Q } from './db';
import { REPAIR_SOURCE, type Op, type PlannedGroup } from './types';

export interface RollbackResult {
  runId: string;
  rolledBack: string[];
  refused: { key: string; reason: string }[];
  locked?: boolean;
}

interface JournalRow {
  id: string;
  groupKey: string;
  companyIds: string[];
  sourceIds: string[];
  operations: Op[];
  inverse: InverseOp[];
  afterHash: string;
  createdIds: string[];
}

export async function rollbackRun(args: {
  url: string;
  runId: string;
  fingerprint: string;
  log: (m: string) => void;
}): Promise<RollbackResult> {
  const lock = await RepairLock.acquire(args.url);
  if (!lock) return { runId: args.runId, rolledBack: [], refused: [], locked: true };
  const db = await writeSession(args.url);
  try {
    const run = (
      await db.query<{ id: string; databaseFingerprint: string; status: string }>(
        `SELECT id, "databaseFingerprint", status FROM "CompanyRepairRun" WHERE id = $1`,
        [args.runId],
      )
    ).rows[0];
    if (!run) throw new Error(`no repair run ${args.runId}`);
    if (run.databaseFingerprint !== args.fingerprint) {
      throw new Error('this run belongs to a different database (fingerprint mismatch) — refusing to write');
    }
    const groups = (
      await db.query<JournalRow>(
        `SELECT id, "groupKey", "companyIds", "sourceIds", operations, inverse, "afterHash", "createdIds" FROM "CompanyRepairGroup"
          WHERE "runId" = $1 AND status = 'APPLIED' ORDER BY "appliedAt" DESC, id DESC`,
        [args.runId],
      )
    ).rows;
    const result: RollbackResult = { runId: args.runId, rolledBack: [], refused: [] };
    for (const g of groups) {
      try {
        await rollbackGroup(db, lock, g);
        result.rolledBack.push(g.groupKey);
        args.log(`rolled back ${g.groupKey}`);
      } catch (err) {
        await db.query('ROLLBACK').catch(() => undefined);
        const pg = err as { code?: string };
        if (err instanceof GroupConflict) result.refused.push({ key: g.groupKey, reason: err.reason });
        else if (pg.code === '40001' || pg.code === '40P01' || pg.code === '55P03') {
          result.refused.push({ key: g.groupKey, reason: `concurrent change (${pg.code})` });
        } else throw err;
        args.log(`REFUSED ${g.groupKey}: ${result.refused[result.refused.length - 1]!.reason}`);
      }
    }
    const left = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "CompanyRepairGroup" WHERE "runId" = $1 AND status = 'APPLIED'`,
      [args.runId],
    );
    await db.query(`UPDATE "CompanyRepairRun" SET status = $2, "updatedAt" = now() WHERE id = $1`, [
      args.runId,
      left.rows[0]!.n === 0 ? 'ROLLED_BACK' : 'PARTIAL',
    ]);
    return result;
  } finally {
    await db.end().catch(() => undefined);
    await lock.release();
  }
}

/** Rebuild the plan group a journal row came from (for the same hydration probe). */
function plannedFrom(row: JournalRow): PlannedGroup {
  const ops = row.operations;
  const create = ops.filter((o): o is Extract<Op, { op: 'createCompany' }> => o.op === 'createCompany');
  const sourceIds = row.sourceIds;
  return {
    key: row.groupKey,
    kind: 'repair',
    companyIds: row.companyIds.filter((id) => !row.createdIds.includes(id)),
    sourceIds,
    observedHash: '',
    probe: { slugs: [], createIds: [] },
    ops,
    expect: { rounds: 0, holdings: 0, amountUsd: '0', totals: {}, slugs: Object.fromEntries(create.map((c) => [c.id, String(c.data.slug)])) },
  };
}

async function rollbackGroup(db: Q, lock: RepairLock, row: JournalRow): Promise<void> {
  await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await lock.assertHeld(db);
  const g = plannedFrom(row);
  await lockGroup(db, row.companyIds, g.sourceIds);
  const now = await journalHash(db, row.companyIds, g.sourceIds);
  if (now !== row.afterHash) {
    throw new GroupConflict(row.groupKey, 'the repaired companies changed since the repair (edits, new records or references) — refusing to overwrite them');
  }
  const investorIds = (
    await db.query<{ investorId: string | null }>(
      `SELECT DISTINCT "investorId" FROM "InvestorHolding" WHERE id = ANY($1::text[])`,
      [row.inverse.filter((o) => o.op === 'moveHolding').map((o) => (o as { id: string }).id)],
    )
  ).rows
    .map((r) => r.investorId)
    .filter((v): v is string => !!v);
  for (const op of row.inverse) await execute(db, row.groupKey, op);
  await refreshDirectoryCounts(prismaShim(db) as never, { investorIds, companyIds: g.companyIds });
  // History is appended, never erased: one UPDATE per restored field, and one
  // "reversed" REPAIR entry per separation undone.
  const revision = (companyId: string, action: string, field: string, before: unknown, after: unknown) =>
    db.query(
      `INSERT INTO "Revision" (id, "companyId", "entityType", "entityId", field, before, after, action, actor, "actorSource", "createdAt")
       VALUES ($1, $2, 'company', $2, $3, $4::jsonb, $5::jsonb, $6, 'INGEST', $7, now())`,
      [`crrv${randomUUID().replace(/-/g, '').slice(0, 21)}`, companyId, field, JSON.stringify(before), JSON.stringify(after), action, REPAIR_SOURCE],
    );
  for (const op of row.inverse) {
    if (op.op !== 'setCompanyField') continue;
    const num = (v: unknown) => (op.field === 'totalRaisedUsd' ? Number(v) : v);
    await revision(op.companyId, 'UPDATE', op.field, num(op.before), num(op.after));
  }
  for (const created of row.operations.filter((o): o is Extract<Op, { op: 'createCompany' }> => o.op === 'createCompany')) {
    const moved = row.operations.filter((o) => (o.op === 'moveRound' || o.op === 'moveHolding') && o.to === created.id);
    const from = moved[0] && 'from' in moved[0] ? moved[0].from : g.companyIds[0]!;
    await revision(from, 'REPAIR', '', null, {
      kind: 'reversed',
      other: { name: String(created.data.name ?? ''), slug: String(created.data.slug ?? '') },
      rounds: moved.filter((o) => o.op === 'moveRound').length,
      holdings: moved.filter((o) => o.op === 'moveHolding').length,
    });
  }
  await db.query(`UPDATE "CompanyRepairGroup" SET status = 'ROLLED_BACK', "rolledBackAt" = now(), "updatedAt" = now() WHERE id = $1`, [row.id]);
  await lock.assertHeld(db);
  await db.query('COMMIT');
}
