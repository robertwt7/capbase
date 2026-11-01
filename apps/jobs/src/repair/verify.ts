/**
 * Verify an applied repair run from its journal, read-only.
 *
 * Integrity failures (nonzero exit): a moved row not on its recorded owner, a
 * created company missing or on another slug, an identifier or citation that
 * no longer resolves, a binding that does not say what the repair wrote, or a
 * group whose rounds, holdings or amount were not conserved.
 *
 * `changedSince` is NOT a failure: it means the group's companies were edited
 * after the repair (which is allowed — it only blocks a rollback).
 */
import { journalHash } from './apply';
import type { Q } from './db';
import type { Op, PlannedGroup } from './types';

export interface GroupVerification {
  key: string;
  status: string;
  changedSince: boolean;
  failures: string[];
}

export interface VerifyResult {
  runId: string;
  runStatus: string;
  groups: GroupVerification[];
  ok: boolean;
}

export async function verifyRun(
  q: Q,
  runId: string,
  expect?: Map<string, PlannedGroup['expect']>,
): Promise<VerifyResult> {
  const run = (await q.query<{ status: string }>(`SELECT status FROM "CompanyRepairRun" WHERE id = $1`, [runId])).rows[0];
  if (!run) throw new Error(`no repair run ${runId}`);
  const rows = (
    await q.query<{ groupKey: string; status: string; companyIds: string[]; sourceIds: string[]; operations: Op[]; afterHash: string; createdIds: string[] }>(
      `SELECT "groupKey", status, "companyIds", "sourceIds", operations, "afterHash", "createdIds" FROM "CompanyRepairGroup" WHERE "runId" = $1 ORDER BY "groupKey"`,
      [runId],
    )
  ).rows;
  const groups: GroupVerification[] = [];
  await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    for (const g of rows) {
      const failures: string[] = [];
      if (g.status !== 'APPLIED') {
        groups.push({ key: g.groupKey, status: g.status, changedSince: false, failures });
        continue;
      }
      const at = async (table: string, id: string) =>
        (await q.query<{ companyId: string }>(`SELECT "companyId" FROM "${table}" WHERE id = $1`, [id])).rows[0]?.companyId;
      for (const op of g.operations) {
        if (op.op === 'moveRound' && (await at('FundingRound', op.id)) !== op.to) failures.push(`round ${op.id} not on ${op.to}`);
        if (op.op === 'moveHolding' && (await at('InvestorHolding', op.id)) !== op.to) failures.push(`holding ${op.id} not on ${op.to}`);
        if (op.op === 'moveRevision' && (await at('Revision', op.id)) !== op.to) failures.push(`revision ${op.id} not on ${op.to}`);
        if (op.op === 'moveIdentifier') {
          const r = (await q.query<{ entityId: string }>(`SELECT "entityId" FROM "EntityIdentifier" WHERE id = $1`, [op.id])).rows[0];
          if (r?.entityId !== op.to) failures.push(`identifier ${op.scheme}:${op.value} not on ${op.to}`);
        }
        if (op.op === 'createCompany') {
          const r = (await q.query<{ slug: string }>(`SELECT slug FROM "Company" WHERE id = $1`, [op.id])).rows[0];
          if (!r) failures.push(`created company ${op.id} missing`);
          else if (r.slug !== op.data.slug) failures.push(`created company ${op.id} is at ${r.slug}, not ${String(op.data.slug)}`);
        }
        if (op.op === 'upsertBinding') {
          const r = (
            await q.query<{ companyId: string | null; status: string }>(
              `SELECT "companyId", status FROM "CompanyIngestBinding" WHERE source = $1 AND "sourceCompanyId" = $2`,
              [op.source, op.sourceCompanyId],
            )
          ).rows[0];
          if (!r || r.companyId !== op.after.companyId || r.status !== op.after.status) {
            failures.push(`binding ${op.sourceCompanyId} does not route to ${op.after.companyId ?? 'a hold'}`);
          }
        }
      }
      // Nothing points at a company that does not exist.
      const dangling = (
        await q.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM "EntityIdentifier" e
            WHERE e."entityType" = 'company' AND e."entityId" = ANY($1::text[])
              AND NOT EXISTS (SELECT 1 FROM "Company" c WHERE c.id = e."entityId")`,
          [g.companyIds],
        )
      ).rows[0]!.n;
      if (dangling) failures.push(`${dangling} identifiers point at a missing company`);
      const childIds = g.operations.filter((o) => o.op === 'moveRound' || o.op === 'moveHolding').map((o) => (o as { id: string }).id);
      const orphanCitations = (
        await q.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM "Citation" ci
            WHERE ci."entityId" = ANY($1::text[]) AND ci."entityType" IN ('round', 'investor')
              AND NOT EXISTS (SELECT 1 FROM "FundingRound" r WHERE r.id = ci."entityId")
              AND NOT EXISTS (SELECT 1 FROM "InvestorHolding" h WHERE h.id = ci."entityId")`,
          [childIds],
        )
      ).rows[0]!.n;
      if (orphanCitations) failures.push(`${orphanCitations} citations no longer resolve`);
      const now = await journalHash(q, g.companyIds, g.sourceIds);
      const changedSince = now !== g.afterHash;
      // Conservation across every company the group touched, against the plan.
      const want = expect?.get(g.groupKey);
      if (want && !changedSince) {
        const got = await conservation(q, g.companyIds);
        if (got.rounds !== want.rounds || got.holdings !== want.holdings || got.amountUsd !== want.amountUsd) {
          failures.push(
            `not conserved: ${got.rounds} rounds / ${got.holdings} holdings / $${got.amountUsd}, ` +
              `plan observed ${want.rounds} / ${want.holdings} / $${want.amountUsd}`,
          );
        }
        for (const [companyId, total] of Object.entries(want.totals)) {
          const r = (await q.query<{ t: string }>(`SELECT "totalRaisedUsd"::text AS t FROM "Company" WHERE id = $1`, [companyId])).rows[0];
          if (r?.t !== total) failures.push(`total on ${companyId} is ${r?.t ?? 'missing'}, expected ${total}`);
        }
      }
      groups.push({ key: g.groupKey, status: g.status, changedSince, failures });
    }
  } finally {
    await q.query('COMMIT');
  }
  return { runId, runStatus: run.status, groups, ok: groups.every((g) => g.failures.length === 0) };
}

/** Conservation of a plan group, checked right after apply in tests and by the
 *  CLI when the plan is at hand: what moved between the group's companies must
 *  add up to what the plan observed. */
export async function conservation(
  q: Q,
  companyIds: string[],
): Promise<{ rounds: number; holdings: number; amountUsd: string }> {
  const r = (
    await q.query<{ rounds: number; holdings: number; amount: string }>(
      `SELECT (SELECT count(*)::int FROM "FundingRound" WHERE "companyId" = ANY($1::text[])) AS rounds,
              (SELECT count(*)::int FROM "InvestorHolding" WHERE "companyId" = ANY($1::text[])) AS holdings,
              (SELECT coalesce(sum("amountUsd"), 0)::text FROM "FundingRound" WHERE "companyId" = ANY($1::text[])) AS amount`,
      [companyIds],
    )
  ).rows[0]!;
  return { rounds: r.rounds, holdings: r.holdings, amountUsd: r.amount };
}
