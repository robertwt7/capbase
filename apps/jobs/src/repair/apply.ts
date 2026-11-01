/**
 * Apply a reviewed repair plan: one bounded SERIALIZABLE transaction per group,
 * committed together with its journal row (CompanyRepairGroup) — the database,
 * not a log file, is the checkpoint.
 *
 * Per group: assert the ingest lock is still held by our lock session; lock the
 * companies (sorted, FOR UPDATE — the owning-row protocol merge and enrichment
 * use, which also blocks any concurrent child insert through its FK) and every
 * child, identifier and binding row the group touches; re-hydrate and compare
 * with the plan's observation; execute the typed operations as compare-and-set
 * updates with exact row counts; refresh the affected directory counts; journal
 * forward + inverse operations and the after-state hash; commit.
 *
 * A stale group is rolled back and reported, never re-planned. Committed groups
 * stay committed; re-running the same command resumes and skips them.
 */
import { randomUUID } from 'node:crypto';

import { refreshDirectoryCounts } from '@repo/db';

import { canonicalJson, sha256 } from '../ingest/company-matcher';
import { bindingBatchEvidence, probeOptions } from './audit';
import { RepairLock, writeSession, type Q } from './db';
import { evidenceHash, hydrate } from './hydrate';
import { COMPANY_COLUMNS, SETTABLE_FIELDS, type BindingState, type Json, type Op, type PlannedGroup, type RepairPlan } from './types';

/** What rollback runs: the forward ops reversed, plus a guarded delete. */
export type InverseOp =
  | Exclude<Op, { op: 'createCompany' } | { op: 'upsertBinding' } | { op: 'appendRevision' }>
  | { op: 'deleteCompany'; id: string; ownRevisionIds: string[] }
  | { op: 'restoreBinding'; source: string; sourceCompanyId: string; current: BindingState; restore: BindingState | null };

export class GroupConflict extends Error {
  constructor(
    readonly groupKey: string,
    readonly reason: string,
  ) {
    super(`${groupKey}: ${reason}`);
  }
}

export interface ApplyHooks {
  /** Called inside the transaction just before COMMIT (tests inject failures here). */
  beforeCommit?: (group: PlannedGroup, tx: Q) => Promise<void>;
}

export interface ApplyResult {
  runId: string;
  applied: string[];
  skipped: string[];
  conflicts: { key: string; reason: string }[];
  status: 'APPLIED' | 'PARTIAL';
  /** Set when the ingest lock was busy: nothing was done (exit 75). */
  locked?: boolean;
}

const ts = () => 'now()';

export async function applyPlan(args: {
  url: string;
  plan: RepairPlan;
  fingerprint: string;
  runId?: string | null;
  label?: string | null;
  log: (m: string) => void;
  hooks?: ApplyHooks;
}): Promise<ApplyResult> {
  const { plan, log } = args;
  if (plan.databaseFingerprint !== args.fingerprint) {
    throw new Error('this plan was made for a different database (fingerprint mismatch) — refusing to write');
  }
  const lock = await RepairLock.acquire(args.url);
  if (!lock) return { runId: '', applied: [], skipped: [], conflicts: [], status: 'PARTIAL', locked: true };
  const db = await writeSession(args.url);
  try {
    const runId = await resolveRun(db, plan, args.fingerprint, args.runId ?? null, args.label ?? null);
    const done = new Map(
      (
        await db.query<{ groupKey: string; status: string }>(`SELECT "groupKey", status FROM "CompanyRepairGroup" WHERE "runId" = $1`, [runId])
      ).rows.map((r) => [r.groupKey, r.status]),
    );
    const result: ApplyResult = { runId, applied: [], skipped: [], conflicts: [], status: 'APPLIED' };
    for (const group of plan.groups) {
      if (done.has(group.key)) {
        result.skipped.push(group.key);
        continue;
      }
      try {
        await applyGroup(db, lock, runId, group, args.hooks);
        result.applied.push(group.key);
        log(`applied ${group.key}`);
      } catch (err) {
        await db.query('ROLLBACK').catch(() => undefined);
        if (err instanceof GroupConflict) {
          result.conflicts.push({ key: group.key, reason: err.reason });
          log(`CONFLICT ${group.key}: ${err.reason}`);
          continue;
        }
        const pg = err as { code?: string; message?: string };
        if (pg.code === '40001' || pg.code === '40P01' || pg.code === '55P03') {
          result.conflicts.push({ key: group.key, reason: `concurrent change (${pg.code})` });
          log(`CONFLICT ${group.key}: concurrent change (${pg.code})`);
          continue;
        }
        throw err;
      }
    }
    const pending = plan.groups.length - result.applied.length - result.skipped.length;
    result.status = pending === 0 ? 'APPLIED' : 'PARTIAL';
    await db.query(
      `UPDATE "CompanyRepairRun" SET status = $2, summary = $3::jsonb, "updatedAt" = now(), "finishedAt" = now() WHERE id = $1`,
      [
        runId,
        result.status,
        JSON.stringify({ groups: plan.groups.length, applied: result.applied.length, skipped: result.skipped.length, conflicts: result.conflicts }),
      ],
    );
    return result;
  } finally {
    await db.end().catch(() => undefined);
    await lock.release();
  }
}

/** The one run for this (target, manifest): repeating the command finds it. */
async function resolveRun(db: Q, plan: RepairPlan, fingerprint: string, runId: string | null, label: string | null): Promise<string> {
  const { rows } = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM "CompanyRepairRun" WHERE "databaseFingerprint" = $1 AND "manifestHash" = $2`,
    [fingerprint, plan.manifestHash],
  );
  const found = rows[0];
  if (runId && (!found || found.id !== runId)) {
    throw new Error(`RUN ${runId} is not the run for this plan on this database — refusing`);
  }
  if (found) {
    if (found.status === 'ROLLED_BACK') throw new Error(`run ${found.id} was rolled back; make a new plan instead`);
    return found.id;
  }
  const id = `crrun${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  await db.query(
    `INSERT INTO "CompanyRepairRun" (id, "databaseFingerprint", "manifestHash", "sourceHash", "toolVersion", "policyVersion", status, label, summary, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, 'RUNNING', $7, '{}'::jsonb, now(), now())`,
    [id, fingerprint, plan.manifestHash, plan.source.bundleSha256, plan.toolVersion, plan.policyVersion, label],
  );
  return id;
}

/** Lock every row a group reads or writes, companies first, in id order. */
export async function lockGroup(tx: Q, companyIds: string[], sourceIds: string[]): Promise<void> {
  const ids = [...new Set(companyIds)].sort();
  await tx.query(`SELECT id FROM "Company" WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, [ids]);
  await tx.query(`SELECT id FROM "FundingRound" WHERE "companyId" = ANY($1::text[]) ORDER BY id FOR UPDATE`, [ids]);
  await tx.query(`SELECT id FROM "InvestorHolding" WHERE "companyId" = ANY($1::text[]) ORDER BY id FOR UPDATE`, [ids]);
  await tx.query(
    `SELECT id FROM "EntityIdentifier" WHERE "entityType" = 'company' AND ("entityId" = ANY($1::text[]) OR (scheme = 'PARTNER' AND value = ANY($2::text[])))
      ORDER BY id FOR UPDATE`,
    [ids, sourceIds],
  );
  await tx.query(`SELECT id FROM "Revision" WHERE "companyId" = ANY($1::text[]) ORDER BY id FOR UPDATE`, [ids]);
  await tx.query(
    `SELECT id FROM "CompanyIngestBinding" WHERE "companyId" = ANY($1::text[]) OR (source = 'PARTNER' AND "sourceCompanyId" = ANY($2::text[]))
      ORDER BY id FOR UPDATE`,
    [ids, sourceIds],
  );
}

async function observe(tx: Q, group: PlannedGroup): Promise<string> {
  if (group.kind === 'repair') return evidenceHash(await hydrate(tx, group.companyIds, probeOptions(group)));
  return bindingBatchEvidence(tx, bindingPairs(group), true);
}

/** The after-state a journal row records and rollback/verify compare against:
 *  every company the group touched — created ones included — and its source
 *  ids' identifiers and bindings. */
export async function journalHash(tx: Q, companyIds: string[], sourceIds: string[]): Promise<string> {
  return evidenceHash(await hydrate(tx, [...new Set(companyIds)].sort(), { sourceIds, bindingsTable: true }));
}

function bindingPairs(group: PlannedGroup): { sourceId: string; companyId: string }[] {
  return group.ops
    .filter((o): o is Extract<Op, { op: 'upsertBinding' }> => o.op === 'upsertBinding')
    .map((o) => ({ sourceId: o.sourceCompanyId, companyId: o.after.companyId ?? '' }));
}

async function applyGroup(db: Q, lock: RepairLock, runId: string, group: PlannedGroup, hooks?: ApplyHooks): Promise<void> {
  await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await lock.assertHeld(db);
  await lockGroup(db, group.companyIds, group.sourceIds);
  const before = await observe(db, group);
  if (before !== group.observedHash) {
    throw new GroupConflict(group.key, 'the data changed since the plan was made (stale group) — make a new plan');
  }
  const created = group.ops.filter((o) => o.op === 'createCompany').map((o) => (o as { id: string }).id);
  const investorIds = await movedInvestors(db, group);
  for (const op of group.ops) await execute(db, group.key, op);
  await refreshDirectoryCounts(prismaShim(db) as never, {
    investorIds,
    companyIds: [...group.companyIds, ...created],
  });
  const after = await journalHash(db, [...group.companyIds, ...created], group.sourceIds);
  const inverse = invert(group.ops);
  await db.query(
    `INSERT INTO "CompanyRepairGroup" (id, "runId", "groupKey", "groupHash", "companyIds", "sourceIds", status, operations, inverse, "beforeHash", "afterHash", "createdIds", "appliedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5::text[], $11::text[], 'APPLIED', $6::jsonb, $7::jsonb, $8, $9, $10::text[], now(), now())`,
    [
      `crgrp${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      runId,
      group.key,
      sha256(canonicalJson(group)),
      [...new Set([...group.companyIds, ...created])].sort(),
      JSON.stringify(group.ops),
      JSON.stringify(inverse),
      before,
      after,
      created,
      group.sourceIds,
    ],
  );
  await hooks?.beforeCommit?.(group, db);
  await lock.assertHeld(db);
  await db.query('COMMIT');
}

/** Investors whose holdings a group moves: their counts are recomputed explicitly. */
async function movedInvestors(tx: Q, group: PlannedGroup): Promise<string[]> {
  const ids = group.ops.filter((o) => o.op === 'moveHolding').map((o) => (o as { id: string }).id);
  if (ids.length === 0) return [];
  const { rows } = await tx.query<{ investorId: string | null }>(
    `SELECT DISTINCT "investorId" FROM "InvestorHolding" WHERE id = ANY($1::text[])`,
    [ids],
  );
  return rows.map((r) => r.investorId).filter((v): v is string => !!v);
}

/** `refreshDirectoryCounts` takes a Prisma client; this runs its tagged SQL on our session. */
export function prismaShim(tx: Q) {
  return {
    $executeRaw: async (sql: { text?: string; sql?: string; values: unknown[] }) => {
      const res = await tx.query(sql.text ?? sql.sql ?? '', sql.values);
      return res.rowCount ?? 0;
    },
  };
}

function expectOne(key: string, what: string, rowCount: number | null): void {
  if (rowCount !== 1) throw new GroupConflict(key, `${what}: expected 1 row, matched ${rowCount ?? 0}`);
}

const col = (name: string) => `"${name}"`;

/** Execute one allowlisted operation as a compare-and-set statement. */
export async function execute(tx: Q, key: string, op: Op | InverseOp): Promise<void> {
  switch (op.op) {
    case 'createCompany': {
      const cols = Object.keys(op.data).filter((c) => c in COMPANY_COLUMNS);
      const values = cols.map((c) => toParam(op.data[c]!));
      const casts = cols.map((c, i) => `$${i + 2}::${COMPANY_COLUMNS[c]}`);
      const res = await tx.query(
        `INSERT INTO "Company" (id, ${cols.map(col).join(', ')}, "createdAt", "updatedAt")
         VALUES ($1, ${casts.join(', ')}, ${ts()}, ${ts()}) ON CONFLICT DO NOTHING`,
        [op.id, ...values],
      );
      expectOne(key, `create ${op.id}`, res.rowCount);
      return;
    }
    case 'deleteCompany': {
      const refs = await tx.query<{ n: number }>(
        `SELECT (SELECT count(*) FROM "FundingRound" WHERE "companyId" = $1)
              + (SELECT count(*) FROM "InvestorHolding" WHERE "companyId" = $1)
              + (SELECT count(*) FROM "PersonRole" WHERE "companyId" = $1)
              + (SELECT count(*) FROM "AcquisitionDeal" WHERE "companyId" = $1)
              + (SELECT count(*) FROM "ExitEvent" WHERE "companyId" = $1)
              + (SELECT count(*) FROM "DiversitySignal" WHERE "companyId" = $1)
              + (SELECT count(*) FROM "ChangeProposal" WHERE "companyId" = $1)
              + (SELECT count(*) FROM "SavedCompany" WHERE "companyId" = $1)
              + (SELECT count(*) FROM "CompanyWebsiteScan" WHERE "companyId" = $1)
              + (SELECT count(*) FROM "CompanyApp" WHERE "companyId" = $1)
              + (SELECT count(*) FROM "Company" WHERE "mergedIntoId" = $1)
              + (SELECT count(*) FROM "EntityIdentifier" WHERE "entityType" = 'company' AND "entityId" = $1)
              + (SELECT count(*) FROM "Citation" WHERE "entityType" = 'company' AND "entityId" = $1)
              + (SELECT count(*) FROM "Report" WHERE "entityType" = 'company' AND "entityId" = $1)
              + (SELECT count(*) FROM "MergeRecord" WHERE "entityType" = 'company' AND ("survivorId" = $1 OR "losingId" = $1))
              + (SELECT count(*) FROM "CompanyIngestBinding" WHERE "companyId" = $1)
              + (SELECT count(*) FROM "Revision" WHERE "companyId" = $1 AND NOT (id = ANY($2::text[]))) AS n`,
        [op.id, op.ownRevisionIds],
      );
      if (Number(refs.rows[0]?.n ?? 1) !== 0) {
        throw new GroupConflict(key, `created company ${op.id} has gained references since the repair — kept for review`);
      }
      expectOne(key, `delete ${op.id}`, (await tx.query(`DELETE FROM "Company" WHERE id = $1`, [op.id])).rowCount);
      return;
    }
    case 'moveRound':
      expectOne(
        key,
        `round ${op.id}`,
        (await tx.query(`UPDATE "FundingRound" SET "companyId" = $3 WHERE id = $1 AND "companyId" = $2`, [op.id, op.from, op.to])).rowCount,
      );
      return;
    case 'moveHolding':
      expectOne(
        key,
        `holding ${op.id}`,
        (await tx.query(`UPDATE "InvestorHolding" SET "companyId" = $3 WHERE id = $1 AND "companyId" = $2`, [op.id, op.from, op.to])).rowCount,
      );
      return;
    case 'moveIdentifier':
      expectOne(
        key,
        `identifier ${op.id}`,
        (
          await tx.query(
            `UPDATE "EntityIdentifier" SET "entityId" = $3 WHERE id = $1 AND "entityId" = $2 AND "entityType" = 'company' AND scheme = $4 AND value = $5`,
            [op.id, op.from, op.to, op.scheme, op.value],
          )
        ).rowCount,
      );
      return;
    case 'moveRevision':
      expectOne(
        key,
        `revision ${op.id}`,
        (await tx.query(`UPDATE "Revision" SET "companyId" = $3 WHERE id = $1 AND "companyId" = $2`, [op.id, op.from, op.to])).rowCount,
      );
      return;
    case 'setCompanyField': {
      if (!SETTABLE_FIELDS.has(op.field)) throw new GroupConflict(key, `field ${op.field} not allowed`);
      const t = COMPANY_COLUMNS[op.field]!;
      expectOne(
        key,
        `${op.field} on ${op.companyId}`,
        (
          await tx.query(
            `UPDATE "Company" SET ${col(op.field)} = $2::${t}, "updatedAt" = now()
              WHERE id = $1 AND ${col(op.field)} IS NOT DISTINCT FROM $3::${t}`,
            [op.companyId, toParam(op.after), toParam(op.before)],
          )
        ).rowCount,
      );
      return;
    }
    case 'upsertBinding': {
      const a = op.after;
      if (op.before === null) {
        const res = await tx.query(
          `INSERT INTO "CompanyIngestBinding" (id, source, "sourceCompanyId", "companyId", status, method, "policyVersion", evidence, "evidenceHash", reference, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, now(), now()) ON CONFLICT DO NOTHING`,
          [`crb${sha256(`${op.source}:${op.sourceCompanyId}`).slice(0, 22)}`, op.source, op.sourceCompanyId, a.companyId, a.status, a.method, 1, JSON.stringify(a.evidence), a.evidenceHash, key],
        );
        expectOne(key, `binding ${op.sourceCompanyId}`, res.rowCount);
      } else {
        await updateBinding(tx, key, op.source, op.sourceCompanyId, op.before, a);
      }
      return;
    }
    case 'restoreBinding':
      if (op.restore === null) {
        expectOne(
          key,
          `binding ${op.sourceCompanyId}`,
          (
            await tx.query(
              `DELETE FROM "CompanyIngestBinding" WHERE source = $1 AND "sourceCompanyId" = $2 AND status = $3 AND "companyId" IS NOT DISTINCT FROM $4 AND method = $5`,
              [op.source, op.sourceCompanyId, op.current.status, op.current.companyId, op.current.method],
            )
          ).rowCount,
        );
      } else {
        await updateBinding(tx, key, op.source, op.sourceCompanyId, op.current, op.restore);
      }
      return;
    case 'appendRevision':
      expectOne(
        key,
        `revision ${op.id}`,
        (
          await tx.query(
            `INSERT INTO "Revision" (id, "companyId", "entityType", "entityId", field, before, after, action, actor, "actorSource", "createdAt")
             VALUES ($1, $2, 'company', $2, $3, $4::jsonb, $5::jsonb, $6, 'INGEST', $7, now()) ON CONFLICT DO NOTHING`,
            [op.id, op.companyId, op.field, JSON.stringify(op.before), JSON.stringify(op.after), op.action, op.actorSource],
          )
        ).rowCount,
      );
      return;
  }
}

async function updateBinding(tx: Q, key: string, source: string, sid: string, from: BindingState, to: BindingState): Promise<void> {
  expectOne(
    key,
    `binding ${sid}`,
    (
      await tx.query(
        `UPDATE "CompanyIngestBinding" SET "companyId" = $3, status = $4, method = $5, evidence = $6::jsonb, "evidenceHash" = $7, reference = $8, "updatedAt" = now()
          WHERE source = $1 AND "sourceCompanyId" = $2 AND status = $9 AND "companyId" IS NOT DISTINCT FROM $10 AND method = $11`,
        [source, sid, to.companyId, to.status, to.method, JSON.stringify(to.evidence), to.evidenceHash, key, from.status, from.companyId, from.method],
      )
    ).rowCount,
  );
}

/** A JSON value as a pg parameter: arrays stay arrays (text[]), the rest as is. */
function toParam(v: Json): unknown {
  return v;
}

/** The exact inverse of a forward operation list, in reverse dependency order.
 *  Appended revisions are history and stay; rollback appends its own. */
export function invert(ops: Op[]): InverseOp[] {
  const out: InverseOp[] = [];
  const revisionsOf = new Map<string, string[]>();
  for (const op of ops) {
    if (op.op === 'appendRevision') revisionsOf.set(op.companyId, [...(revisionsOf.get(op.companyId) ?? []), op.id]);
  }
  for (const op of [...ops].reverse()) {
    switch (op.op) {
      case 'createCompany':
        out.push({ op: 'deleteCompany', id: op.id, ownRevisionIds: revisionsOf.get(op.id) ?? [] });
        break;
      case 'moveRound':
      case 'moveHolding':
      case 'moveRevision':
        out.push({ ...op, from: op.to, to: op.from });
        break;
      case 'moveIdentifier':
        out.push({ ...op, from: op.to, to: op.from });
        break;
      case 'setCompanyField':
        out.push({ ...op, before: op.after, after: op.before });
        break;
      case 'upsertBinding':
        out.push({ op: 'restoreBinding', source: op.source, sourceCompanyId: op.sourceCompanyId, current: op.after, restore: op.before });
        break;
      case 'appendRevision':
        break;
    }
  }
  // Moves first, then the guarded delete: a created company must be empty.
  return [...out.filter((o) => o.op !== 'deleteCompany'), ...out.filter((o) => o.op === 'deleteCompany')];
}
