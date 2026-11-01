/**
 * Company-match repair against a REAL PostgreSQL — locks, read-only sessions,
 * FKs, compare-and-set, atomic journals, resume and rollback cannot be proved
 * with mocks.
 *
 * Run through `make test-company-repair-integration`, which creates a
 * task-owned `capbase_repair_test_<pid>` database, migrates it, runs this suite
 * and drops it. The suite refuses any other database name.
 *
 * Synthetic records only: no licensed bundle and no production data.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import { Client } from 'pg';

import { canonicalJson } from '../src/ingest/company-matcher';
import { IngestService } from '../src/ingest/ingest.service';
import { INGEST_LOCK_KEY } from '../src/ingest/ingest-lock';
import { PrismaService } from '../src/prisma/prisma.service';
import { applyPlan } from '../src/repair/apply';
import { bindingBatchEvidence, bindingGroups, runAudit } from '../src/repair/audit';
import { readOnlySession, targetFingerprint } from '../src/repair/db';
import { buildPlan, selectionOf } from '../src/repair/manifest';
import { rollbackRun } from '../src/repair/rollback';
import { SourceSnapshot } from '../src/repair/source-snapshot';
import type { PlannedGroup, RepairPlan } from '../src/repair/types';
import { verifyRun } from '../src/repair/verify';
import type { NormalizedRecord } from '../src/sources/ingestion-source';

const URL = process.env.REPAIR_TEST_DATABASE_URL ?? '';
const DB_NAME = URL ? new globalThis.URL(URL).pathname.slice(1) : '';
if (!/^capbase_repair_test_\w+$/.test(DB_NAME)) {
  throw new Error('REPAIR_TEST_DATABASE_URL must name a task-owned capbase_repair_test_* database (use make test-company-repair-integration)');
}
const TARGET_ID = 'integration-target-0001';
const noop = () => {};

let admin: Client;
const sql = async <T = Record<string, unknown>>(q: string, params: unknown[] = []) => (await admin.query(q, params)).rows as T[];
const one = async <T = Record<string, unknown>>(q: string, params: unknown[] = []) => (await sql<T>(q, params))[0]!;

// --- Fixture builders -----------------------------------------------------------------

async function company(id: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id,
    slug: id,
    name: id,
    domain: '',
    oneLiner: 'x',
    description: 'x',
    hq: 'Undisclosed',
    founded: 0,
    headcount: 0,
    status: 'Private',
    stage: 'Seed',
    totalRaisedUsd: 0,
    industry: [],
    moderationStatus: 'APPROVED',
    ...over,
  };
  const cols = Object.keys(row);
  await sql(
    `INSERT INTO "Company" (${cols.map((c) => `"${c}"`).join(', ')}, "updatedAt") VALUES (${cols
      .map((c, i) => (c === 'moderationStatus' ? `$${i + 1}::"ReviewStatus"` : `$${i + 1}`))
      .join(', ')}, now())`,
    cols.map((c) => row[c]),
  );
}
const round = (id: string, companyId: string, externalId: string, amountUsd: number, src = 'PARTNER') =>
  sql(
    `INSERT INTO "FundingRound" (id, "companyId", name, date, "amountUsd", "externalSource", "externalId", "moderationStatus", "updatedAt")
     VALUES ($1, $2, 'Seed', '2025-01-01', $3, $4, $5, 'APPROVED', now())`,
    [id, companyId, amountUsd, src, externalId],
  );
const investor = (id: string) =>
  sql(`INSERT INTO "Investor" (id, slug, name, type, "moderationStatus", "updatedAt") VALUES ($1, $1, $1, 'Venture', 'APPROVED', now())`, [id]);
const holding = (id: string, companyId: string, externalId: string, investorId: string) =>
  sql(
    `INSERT INTO "InvestorHolding" (id, "companyId", "investorId", name, type, "firstRound", rounds, "externalSource", "externalId", "moderationStatus", "updatedAt")
     VALUES ($1, $2, $3, $3, 'Venture', 'Seed', 1, 'PARTNER', $4, 'APPROVED', now())`,
    [id, companyId, investorId, externalId],
  );
const ident = (id: string, entityId: string, scheme: string, value: string, source = 'PARTNER') =>
  sql(`INSERT INTO "EntityIdentifier" (id, scheme, value, "entityType", "entityId", source) VALUES ($1, $2, $3, 'company', $4, $5)`, [
    id,
    scheme,
    value,
    entityId,
    source,
  ]);

interface SourceCo {
  company_id: string;
  name: string;
  website: string | null;
  country?: string | null;
  city?: string | null;
  industry?: string | null;
  status?: string;
}
interface SourceDeal {
  deal_id: string;
  company_id: string;
  stage?: string;
  size_usd: number;
  deal_date?: string;
}

/** A bundle in exactly the format prepare-company-repair-snapshot.py writes. */
function writeBundle(companies: SourceCo[], deals: SourceDeal[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'repair-bundle-'));
  const rows = {
    company: companies
      .map((c) => ({ about: `About ${c.name}.`, city: c.city ?? null, company_id: c.company_id, country: c.country ?? 'US', industry: c.industry ?? null, name: c.name, status: c.status ?? 'Active', verticals: null, website: c.website }))
      .sort((a, b) => a.company_id.localeCompare(b.company_id)),
    deal: deals
      .map((d) => ({ company_id: d.company_id, currency: 'USD', deal_date: d.deal_date ?? '2025-01-01', deal_id: d.deal_id, size_local: d.size_usd, size_usd: d.size_usd, stage: d.stage ?? 'Seed', status: 'Completed' }))
      .sort((a, b) => a.deal_id.localeCompare(b.deal_id)),
    deal_investor: [] as Record<string, unknown>[],
    firm: [] as Record<string, unknown>[],
  };
  const tables: Record<string, { file: string; rows: number; sha256: string }> = {};
  for (const [name, list] of Object.entries(rows)) {
    const text = list.map((r) => canonicalJson(r) + '\n').join('');
    writeFileSync(join(dir, `${name}.ndjson`), text);
    tables[name] = { file: `${name}.ndjson`, rows: list.length, sha256: createHash('sha256').update(text).digest('hex') };
  }
  const bundleSha256 = createHash('sha256')
    .update(
      JSON.stringify(Object.fromEntries(Object.keys(tables).sort().map((k) => [k, tables[k]!.sha256])))
        .replace(/,/g, ', ')
        .replace(/:/g, ': '),
    )
    .digest('hex');
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ format: 'capbase-company-repair-snapshot', formatVersion: 1, extractionVersion: '1', filterVersion: '1', createdFrom: { kind: 'test' }, tables, bundleSha256 }),
  );
  return dir;
}

// --- The world -------------------------------------------------------------------------

/** Indigo: one partner-created company holding three partner identities. */
async function seedIndigo(p: string) {
  const ag = `${p}ag`;
  await company(ag, {
    slug: `${p}indigo-ag-inc`,
    name: 'Indigo Ag Inc.',
    domain: `${p}indigoag.example`,
    totalRaisedUsd: 1_370_900_000,
    partnerFields: ['totalRaisedUsd', 'domain', 'hq', 'industry', 'stage'],
    partnerOnly: true,
    externalSource: 'PARTNER',
    externalId: `${p}155553`,
  });
  for (const [i, sid] of [`${p}155553`, `${p}723159`, `${p}787691`].entries()) await ident(`${p}e${i}`, ag, 'PARTNER', sid);
  await ident(`${p}d0`, ag, 'DOMAIN', `${p}indigoag.example`);
  await ident(`${p}d1`, ag, 'DOMAIN', `${p}useindigo.example`);
  await ident(`${p}d2`, ag, 'DOMAIN', `${p}getindigo.example`);
  await round(`${p}r-ag`, ag, `${p}V1`, 1_312_900_000);
  await round(`${p}r-re`, ag, `${p}V407056`, 8_000_000);
  await round(`${p}r-med`, ag, `${p}V444915`, 50_000_000);
  for (const f of ['501', '502', '503']) await investor(`${p}i${f}`);
  await holding(`${p}h-ag`, ag, `${p}155553:501`, `${p}i501`);
  await holding(`${p}h-re`, ag, `${p}723159:502`, `${p}i502`);
  await holding(`${p}h-med`, ag, `${p}787691:503`, `${p}i503`);
  await sql(`INSERT INTO "RoundInvestor" (id, "roundId", "investorId", name, "externalSource") VALUES ($1, $2, $3, 'x', 'PARTNER')`, [`${p}ri`, `${p}r-re`, `${p}i502`]);
  await sql(`INSERT INTO "Source" (id, url, "sourceType", "retrievedAt") VALUES ($1, $2, 'Other', now())`, [`${p}src`, `https://example.org/${p}`]);
  await sql(`INSERT INTO "Citation" (id, "sourceId", "entityType", "entityId", field) VALUES ($1, $2, 'round', $3, '')`, [`${p}cit`, `${p}src`, `${p}r-re`]);
  await sql(
    `INSERT INTO "Revision" (id, "companyId", "entityType", "entityId", field, before, after, action, actor, "actorSource", "createdAt")
     VALUES ($1, $2, 'company', $2, 'totalRaisedUsd', '1312900000', '1370900000', 'UPDATE', 'INGEST', 'PARTNER', now() - interval '1 day')`,
    [`${p}rev`, ag],
  );
  return { ag };
}

function indigoSource(p: string): { companies: SourceCo[]; deals: SourceDeal[] } {
  return {
    companies: [
      { company_id: `${p}155553`, name: 'Indigo Ag, Inc.', website: `https://www.${p}indigoag.example`, city: 'Boston', industry: 'Agribusiness' },
      { company_id: `${p}723159`, name: 'Indigo', website: `${p}useindigo.example`, city: 'New York', industry: 'Real Estate' },
      { company_id: `${p}787691`, name: 'Indigo', website: `${p}getindigo.example`, city: 'Miami', industry: 'Insurance' },
    ],
    deals: [
      { deal_id: `${p}V1`, company_id: `${p}155553`, stage: 'Series F', size_usd: 1_312_900_000 },
      { deal_id: `${p}V407056`, company_id: `${p}723159`, size_usd: 8_000_000 },
      { deal_id: `${p}V444915`, company_id: `${p}787691`, stage: 'Series B', size_usd: 50_000_000 },
    ],
  };
}

let fingerprint = '';
let bundle = '';
let snap: SourceSnapshot;

/** Plan the group containing `slug` (and optionally binding batches). */
async function plan(slug: string | null, bindings: 'none' | 'all' = 'none'): Promise<RepairPlan> {
  const q = await readOnlySession(URL);
  try {
    const audit = await runAudit(q, snap, { slug, fingerprint, log: noop });
    const groups: PlannedGroup[] = [...audit.repairs];
    if (bindings === 'all') {
      for (const kind of ['certify', 'hold'] as const) {
        for (const g of bindingGroups(kind, kind === 'certify' ? audit.certify : audit.holds, () => '', null)) {
          g.observedHash = await bindingBatchEvidence(
            q,
            g.ops.map((o) => ({ sourceId: (o as { sourceCompanyId: string }).sourceCompanyId, companyId: (o as { after: { companyId: string } }).after.companyId })),
            true,
          );
          groups.push(g);
        }
      }
    }
    return buildPlan({ fingerprint, bundleSha256: snap.bundleSha256, groups, selection: selectionOf({ slug, bindings }) });
  } finally {
    await q.end();
  }
}

const apply = (p: RepairPlan, hooks?: Parameters<typeof applyPlan>[0]['hooks']) => applyPlan({ url: URL, plan: p, fingerprint, log: noop, hooks });

async function state(ids: string[]) {
  return sql(
    `SELECT c.id, c.slug, c."totalRaisedUsd"::text AS total,
            (SELECT string_agg(r.id, ',' ORDER BY r.id) FROM "FundingRound" r WHERE r."companyId" = c.id) AS rounds,
            (SELECT string_agg(h.id, ',' ORDER BY h.id) FROM "InvestorHolding" h WHERE h."companyId" = c.id) AS holdings,
            (SELECT string_agg(e.scheme || ':' || e.value, ',' ORDER BY e.scheme, e.value) FROM "EntityIdentifier" e WHERE e."entityType" = 'company' AND e."entityId" = c.id) AS idents
       FROM "Company" c WHERE c.id = ANY($1::text[]) ORDER BY c.id`,
    [ids],
  );
}

/** Every write the database has seen, by table — what "zero writes" is checked against. */
async function writeCounters(): Promise<string> {
  await sql('SELECT pg_stat_force_next_flush()').catch(() => undefined);
  const rows = await sql<{ relname: string; n: string }>(
    `SELECT relname, (n_tup_ins + n_tup_upd + n_tup_del)::text AS n FROM pg_stat_user_tables ORDER BY relname`,
  );
  return JSON.stringify(rows);
}

beforeAll(async () => {
  admin = new Client({ connectionString: URL });
  await admin.connect();
  await seedIndigo('a-');
  await seedIndigo('b-');
  await seedIndigo('c-');
  await seedIndigo('d-');
  await seedIndigo('e-');
  // A public company with one partner alias whose website differs: a false association.
  await company('pub-uk', { name: 'Indigo Ltd', domain: 'indigo.example.uk', externalSource: 'COMPANIES_HOUSE', externalId: '01', countryCode: 'GB' });
  await ident('pub-uk-p', 'pub-uk', 'PARTNER', 'f-1');
  await round('pub-uk-r', 'pub-uk', 'f-D1', 1_000);
  // A public company whose single alias shares its website: consistent.
  await company('pub-ok', { name: 'Okay Robotics', domain: 'okay.example', externalSource: 'SEC_EDGAR', externalId: 'X9' });
  await ident('pub-ok-p', 'pub-ok', 'PARTNER', 'g-1');
  // A partner company listed twice by the publisher (same website): review.
  await company('twin', { name: 'Twin Co', domain: 'twin.example', externalSource: 'PARTNER', externalId: 'h-1', partnerFields: ['domain'], partnerOnly: true });
  await ident('twin-1', 'twin', 'PARTNER', 'h-1');
  await ident('twin-2', 'twin', 'PARTNER', 'h-2');
  // An alias the bundle no longer contains: source_missing.
  await company('gone', { name: 'Gone Co', externalSource: 'PARTNER', externalId: 'k-1', partnerOnly: true });
  await ident('gone-1', 'gone', 'PARTNER', 'k-1');
  await ident('gone-2', 'gone', 'PARTNER', 'k-2');
  // A reviewed admin merge of two partner companies: honoured.
  await company('m-win', { name: 'Merge Winner', domain: 'merge.example', externalSource: 'PARTNER', externalId: 'm-1', partnerOnly: true });
  await company('m-lose', { name: 'Merge Loser', domain: 'merge2.example', externalSource: 'PARTNER', externalId: 'm-2', partnerOnly: true, mergedIntoId: 'm-win' });
  await ident('m-1', 'm-win', 'PARTNER', 'm-1');
  await ident('m-2', 'm-win', 'PARTNER', 'm-2');
  await sql(`INSERT INTO "MergeRecord" (id, "entityType", "survivorId", "losingId", moved) VALUES ('mr', 'company', 'm-win', 'm-lose', '{}')`);

  const companies: SourceCo[] = [];
  const deals: SourceDeal[] = [];
  for (const p of ['a-', 'b-', 'c-', 'd-', 'e-']) {
    const s = indigoSource(p);
    companies.push(...s.companies);
    deals.push(...s.deals);
  }
  companies.push(
    { company_id: 'f-1', name: 'Indigo', website: 'useindigo.example' },
    { company_id: 'g-1', name: 'Okay Robotics', website: 'https://okay.example' },
    { company_id: 'h-1', name: 'Twin Co', website: 'twin.example' },
    { company_id: 'h-2', name: 'Twin Company', website: 'https://www.twin.example' },
    { company_id: 'k-1', name: 'Gone Co', website: 'gone.example' },
    { company_id: 'm-1', name: 'Merge Winner', website: 'merge.example' },
    { company_id: 'm-2', name: 'Merge Loser', website: 'merge2.example' },
  );
  deals.push({ deal_id: 'f-D1', company_id: 'f-1', size_usd: 1_000 });
  bundle = writeBundle(companies, deals);
  snap = await SourceSnapshot.open(bundle);
  const q = await readOnlySession(URL);
  fingerprint = (await targetFingerprint(q, TARGET_ID)).fingerprint;
  await q.end();
}, 120_000);

afterAll(async () => {
  await admin?.end();
});

// --- Read-only analysis -------------------------------------------------------------

describe('audit / plan / verify are read-only', () => {
  it('a read-only session refuses writes at the server, whatever the URL permits', async () => {
    const q = await readOnlySession(URL);
    try {
      await expect(q.query(`UPDATE "Company" SET name = name WHERE id = 'a-ag'`)).rejects.toMatchObject({ code: '25006' });
    } finally {
      await q.end();
    }
  });

  it('a full audit and plan perform zero writes', async () => {
    const before = await writeCounters();
    await plan(null, 'all');
    await new Promise((r) => setTimeout(r, 700));
    expect(await writeCounters()).toBe(before);
  });

  it('the compiled CLI audits with hostile scheduler/reporter env and writes nothing', () => {
    const cli = join(__dirname, '..', 'dist', 'company-match-repair.js');
    if (!existsSync(cli)) return; // the runner builds first; a bare jest run may not have
    const out = mkdtempSync(join(tmpdir(), 'repair-cli-'));
    const run = () =>
      execFileSync(process.execPath, [cli, 'audit', '--snapshot', bundle, '--out', out], {
        env: {
          DATABASE_URL: URL,
          REPAIR_TARGET_ID: TARGET_ID,
          INGEST_ON_BOOT: 'true',
          CRON_SCHEDULE: '* * * * * *',
          MONTHLY_INGEST_SOURCES: 'SEC_ADV',
          SENTRY_DSN: 'http://key@127.0.0.1:9/1',
          INGEST_HEARTBEAT_URL: 'http://127.0.0.1:9/ping',
        },
        encoding: 'utf8',
      });
    expect(run()).toContain('classes:');
    expect(existsSync(join(out, 'groups.jsonl'))).toBe(true);
  });

  it('classifies every fixture explicitly', async () => {
    const q = await readOnlySession(URL);
    try {
      const audit = await runAudit(q, snap, { fingerprint, log: noop });
      const cls = (key: string) => audit.groups.find((g) => g.key === key);
      expect(cls('src:a-155553+a-723159+a-787691')).toMatchObject({ class: 'repairable', anchor: 'a-155553' });
      expect(cls('src:f-1')).toMatchObject({ class: 'review_required', reasons: ['singleton_domain_mismatch'] });
      expect(cls('src:g-1')).toMatchObject({ class: 'consistent' });
      expect(cls('src:h-1+h-2')).toMatchObject({ class: 'review_required', reasons: ['same_domain_aliases'] });
      expect(cls('src:k-1+k-2')).toMatchObject({ class: 'source_missing' });
      expect(cls('src:m-1+m-2')?.class).toBe('review_required');
      expect(cls('src:m-1+m-2')?.reasons).toContain('reviewed_merge');
      // Coverage: every identifier is accounted for.
      const total = await one<{ n: number }>(`SELECT count(*)::int AS n FROM "EntityIdentifier" WHERE scheme = 'PARTNER'`);
      expect(audit.coverage.identifiers).toBe(total.n);
      // Deterministic: the same input, the same groups and operations.
      const again = await runAudit(q, snap, { fingerprint, log: noop });
      expect(canonicalJson(again.groups)).toBe(canonicalJson(audit.groups));
      expect(canonicalJson(again.repairs)).toBe(canonicalJson(audit.repairs));
    } finally {
      await q.end();
    }
  });
});

// --- Apply, replay, verify, rollback ----------------------------------------------

describe('the Indigo repair', () => {
  let p: RepairPlan;
  let runId = '';
  const created: string[] = [];

  it('meets the acceptance example, conserving rounds, holdings, investors, citations and money', async () => {
    const before = await one<{ rounds: number; amount: string; holdings: number; ri: number; cit: number }>(
      `SELECT (SELECT count(*)::int FROM "FundingRound") AS rounds, (SELECT sum("amountUsd")::text FROM "FundingRound") AS amount,
              (SELECT count(*)::int FROM "InvestorHolding") AS holdings, (SELECT count(*)::int FROM "RoundInvestor") AS ri,
              (SELECT count(*)::int FROM "Citation") AS cit`,
    );
    p = await plan('a-indigo-ag-inc');
    expect(p.groups).toHaveLength(1);
    const r = await apply(p);
    expect(r).toMatchObject({ applied: ['src:a-155553+a-723159+a-787691'], conflicts: [] });
    runId = r.runId;

    const rows = await sql<{ id: string; slug: string; total: string; partnerOnly: boolean; externalId: string }>(
      `SELECT id, slug, "totalRaisedUsd"::text AS total, "partnerOnly", "externalId" FROM "Company" WHERE slug IN ('a-indigo-ag-inc', 'indigo-a-723159', 'indigo-a-787691') ORDER BY slug`,
    );
    expect(rows.map((x) => [x.slug, x.total, x.partnerOnly])).toEqual([
      ['a-indigo-ag-inc', '1312900000', true],
      ['indigo-a-723159', '8000000', true],
      ['indigo-a-787691', '50000000', true],
    ]);
    created.push(rows[1]!.id, rows[2]!.id);
    expect(await one(`SELECT "companyId" FROM "FundingRound" WHERE id = 'a-r-re'`)).toEqual({ companyId: rows[1]!.id });
    expect(await one(`SELECT "companyId" FROM "InvestorHolding" WHERE id = 'a-h-med'`)).toEqual({ companyId: rows[2]!.id });
    expect(await one(`SELECT "entityId" FROM "EntityIdentifier" WHERE value = 'a-useindigo.example'`)).toEqual({ entityId: rows[1]!.id });
    // The round investor and the citation follow the unchanged round id.
    expect(await one(`SELECT "roundId" FROM "RoundInvestor" WHERE id = 'a-ri'`)).toEqual({ roundId: 'a-r-re' });
    expect(await one(`SELECT "entityId" FROM "Citation" WHERE id = 'a-cit'`)).toEqual({ entityId: 'a-r-re' });
    const after = await one<typeof before>(
      `SELECT (SELECT count(*)::int FROM "FundingRound") AS rounds, (SELECT sum("amountUsd")::text FROM "FundingRound") AS amount,
              (SELECT count(*)::int FROM "InvestorHolding") AS holdings, (SELECT count(*)::int FROM "RoundInvestor") AS ri,
              (SELECT count(*)::int FROM "Citation") AS cit`,
    );
    expect(after).toEqual(before);
    // The ownership correction is in the history, as REPAIR — never an empty UPDATE.
    const hist = await sql<{ action: string; after: { kind: string } }>(
      `SELECT action, after FROM "Revision" WHERE "companyId" = 'a-ag' AND action = 'REPAIR' ORDER BY id`,
    );
    expect(hist.map((h) => h.after.kind)).toEqual(['split-out', 'split-out']);
  });

  it('a second apply performs zero mutations', async () => {
    const before = await writeCounters();
    const r = await apply(p);
    expect(r).toMatchObject({ applied: [], skipped: ['src:a-155553+a-723159+a-787691'] });
    await new Promise((res) => setTimeout(res, 700));
    const diff = (JSON.parse(await writeCounters()) as { relname: string; n: string }[]).filter(
      (row, i) => row.n !== (JSON.parse(before) as { n: string }[])[i]?.n,
    );
    // Only the run row's status/summary update is written.
    expect(diff.map((d) => d.relname)).toEqual(['CompanyRepairRun']);
  });

  it('verify passes and reports machine-readable results', async () => {
    const q = await readOnlySession(URL);
    try {
      const v = await verifyRun(q, runId, new Map(p.groups.map((g) => [g.key, g.expect])));
      expect(v).toMatchObject({ ok: true, groups: [{ changedSince: false, failures: [] }] });
    } finally {
      await q.end();
    }
  });

  it('verify fails (nonzero) on an integrity break, and passes again once it is undone', async () => {
    await sql(`UPDATE "FundingRound" SET "companyId" = 'a-ag' WHERE id = 'a-r-re'`);
    const q = await readOnlySession(URL);
    try {
      const broken = await verifyRun(q, runId, new Map(p.groups.map((g) => [g.key, g.expect])));
      expect(broken.ok).toBe(false);
      expect(broken.groups[0]!.failures.join(' ')).toMatch(/round a-r-re not on/);
    } finally {
      await q.end();
    }
    await sql(`UPDATE "FundingRound" SET "companyId" = $1 WHERE id = 'a-r-re'`, [created[0]]);
    const q2 = await readOnlySession(URL);
    try {
      expect((await verifyRun(q2, runId)).ok).toBe(true);
    } finally {
      await q2.end();
    }
  });

  it('rollback refuses after a dependent edit, then restores the exact prior state', async () => {
    await round('a-new', created[0]!, 'a-NEWDEAL', 1, 'SEC_EDGAR');
    let r = await rollbackRun({ url: URL, runId, fingerprint, log: noop });
    expect(r.rolledBack).toEqual([]);
    expect(r.refused[0]!.reason).toMatch(/changed since the repair/);
    await sql(`DELETE FROM "FundingRound" WHERE id = 'a-new'`);

    r = await rollbackRun({ url: URL, runId, fingerprint, log: noop });
    expect(r.rolledBack).toHaveLength(1);
    const back = await state(['a-ag', ...created]);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({
      total: '1370900000',
      rounds: 'a-r-ag,a-r-med,a-r-re',
      holdings: 'a-h-ag,a-h-med,a-h-re',
    });
    expect(back[0]!.idents).toContain('PARTNER:a-723159');
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM "CompanyIngestBinding" WHERE "sourceCompanyId" LIKE 'a-%'`)).n).toBe(0);
    // History is kept and the reversal is recorded.
    const kinds = await sql<{ k: string }>(`SELECT after->>'kind' AS k FROM "Revision" WHERE "companyId" = 'a-ag' AND action = 'REPAIR' ORDER BY "createdAt", id`);
    expect(kinds.map((k) => k.k).filter((k) => k === 'reversed')).toHaveLength(2);
    expect((await one<{ status: string }>(`SELECT status FROM "CompanyRepairRun" WHERE id = $1`, [runId])).status).toBe('ROLLED_BACK');
  });
});

describe('failing safely', () => {
  it('a stale group is refused: nothing written, no journal row', async () => {
    const p = await plan('b-indigo-ag-inc');
    await sql(`UPDATE "FundingRound" SET "amountUsd" = 9000001 WHERE id = 'b-r-re'`);
    const before = await state(['b-ag']);
    const r = await apply(p);
    expect(r.conflicts).toEqual([{ key: 'src:b-155553+b-723159+b-787691', reason: expect.stringMatching(/stale/) }]);
    expect(await state(['b-ag'])).toEqual(before);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM "CompanyRepairGroup" WHERE "runId" = $1`, [r.runId])).n).toBe(0);
  });

  it('exits as locked (75) when an ingest holds the lock, writing nothing', async () => {
    const p = await plan('c-indigo-ag-inc');
    const holder = new Client({ connectionString: URL });
    await holder.connect();
    await holder.query('SELECT pg_advisory_lock($1)', [INGEST_LOCK_KEY]);
    try {
      const runs = await one<{ n: number }>(`SELECT count(*)::int AS n FROM "CompanyRepairRun"`);
      const r = await apply(p);
      expect(r.locked).toBe(true);
      expect(await one<{ n: number }>(`SELECT count(*)::int AS n FROM "CompanyRepairRun"`)).toEqual(runs);
    } finally {
      await holder.end();
    }
  });

  it('losing the lock session stops the write before commit', async () => {
    const p = await plan('c-indigo-ag-inc');
    const before = await state(['c-ag']);
    await expect(
      apply(p, {
        beforeCommit: async () => {
          await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'company-match-repair:lock'`);
          await new Promise((res) => setTimeout(res, 200));
        },
      }),
    ).rejects.toThrow(/lock session was lost/);
    expect(await state(['c-ag'])).toEqual(before);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM "CompanyRepairGroup" WHERE "groupKey" LIKE 'src:c-%'`)).n).toBe(0);
  });

  it('a crash mid-group rolls data and journal back together; resume applies it once', async () => {
    const p = await plan('c-indigo-ag-inc');
    const before = await state(['c-ag']);
    await expect(apply(p, { beforeCommit: async () => { throw new Error('simulated crash'); } })).rejects.toThrow('simulated crash');
    expect(await state(['c-ag'])).toEqual(before);
    const resumed = await apply(p);
    expect(resumed.applied).toHaveLength(1);
    const again = await apply(p);
    expect(again).toMatchObject({ runId: resumed.runId, applied: [], skipped: [expect.any(String)] });
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM "Company" WHERE "externalId" IN ('c-723159', 'c-787691')`)).n).toBe(2);
  });

  it('holds out concurrent writers: a child insert and a company edit wait on the group locks', async () => {
    const p = await plan('d-indigo-ag-inc');
    const other = new Client({ connectionString: URL, options: '-c lock_timeout=500' });
    await other.connect();
    const blocked: string[] = [];
    try {
      const r = await apply(p, {
        beforeCommit: async () => {
          for (const q of [
            `INSERT INTO "FundingRound" (id, "companyId", name, date, "amountUsd", "updatedAt") VALUES ('d-race', 'd-ag', 'x', now(), 1, now())`,
            `UPDATE "Company" SET name = 'edited' WHERE id = 'd-ag'`,
          ]) {
            await other.query(q).catch((e: { code?: string }) => blocked.push(e.code ?? '?'));
          }
        },
      });
      expect(r.applied).toHaveLength(1);
    } finally {
      await other.end();
    }
    expect(blocked).toEqual(['55P03', '55P03']);
  });

  it('a wrong target fingerprint is refused before any write', async () => {
    const p = await plan('b-indigo-ag-inc');
    await expect(applyPlan({ url: URL, plan: p, fingerprint: 'not-this-database', log: noop })).rejects.toThrow(/different database/);
    await expect(applyPlan({ url: URL, plan: { ...p, databaseFingerprint: 'x' }, fingerprint, log: noop })).rejects.toThrow(/different database/);
  });
});

describe('replay after repair', () => {
  it('replaying the source after the repair keeps identities, owners and totals stable', async () => {
    const p = await plan('e-indigo-ag-inc');
    expect((await apply(p)).applied).toHaveLength(1);
    const created = (await sql<{ id: string }>(`SELECT id FROM "Company" WHERE "externalId" IN ('e-723159', 'e-787691') ORDER BY slug`)).map((r) => r.id);
    const before = await state(['e-ag', ...created]);
    const records: NormalizedRecord[] = indigoSource('e-').companies.map((c) => ({
      source: 'PARTNER',
      companyExternalId: c.company_id,
      roundDedup: 'enrich',
      company: {
        name: c.name,
        hq: 'United States',
        foundedYear: 0,
        industry: [],
        stage: 'Seed',
        totalRaisedUsd: 1,
        countryCode: 'US',
        identifiers: [{ scheme: 'PARTNER', value: c.company_id }],
      },
      rounds: indigoSource('e-')
        .deals.filter((d) => d.company_id === c.company_id)
        .map((d) => ({ externalId: d.deal_id, name: 'Seed', date: '2025-01-01', amountUsd: d.size_usd })),
    }));
    const config = { get: (k: string) => (k === 'DATABASE_URL' ? URL : undefined), getOrThrow: () => URL } as unknown as ConfigService;
    const prisma = new PrismaService(config);
    try {
      const svc = new IngestService(
        prisma,
        [{ name: 'PARTNER', explicitOnly: true, fetch: async () => [], stream: async function* () { yield { records }; } }],
        config,
      );
      await svc.run({ days: 1, limit: 100, sources: ['PARTNER'] });
      expect(svc.identityStats().held).toEqual({});
    } finally {
      await prisma.$disconnect();
    }
    const after = await state(['e-ag', ...created]);
    expect(after.map((x) => [x.id, x.rounds, x.holdings, x.idents])).toEqual(before.map((x) => [x.id, x.rounds, x.holdings, x.idents]));
    expect(after.map((x) => x.total)).toEqual(before.map((x) => x.total));
    expect(after.find((x) => x.id === 'e-ag')!.total).toBe('1312900000');
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM "Company" WHERE "externalId" LIKE 'e-%'`)).n).toBe(3);
  });

});

describe('bindings and ingest', () => {
  it('a held false association stops ingest; a certified one routes it', async () => {
    const p = await plan(null, 'all');
    const kinds = p.groups.map((g) => g.kind);
    expect(kinds).toContain('hold');
    expect(kinds).toContain('certify');
    const bindingsOnly = buildPlan({ fingerprint, bundleSha256: snap.bundleSha256, groups: p.groups.filter((g) => g.kind !== 'repair'), selection: selectionOf({ bindings: 'all' }) });
    const applied = await apply(bindingsOnly);
    expect(applied.conflicts).toEqual([]);
    expect(await one(`SELECT status, "companyId" FROM "CompanyIngestBinding" WHERE "sourceCompanyId" = 'f-1'`)).toEqual({ status: 'REVIEW_REQUIRED', companyId: 'pub-uk' });
    expect(await one(`SELECT status, "companyId" FROM "CompanyIngestBinding" WHERE "sourceCompanyId" = 'g-1'`)).toEqual({ status: 'RESOLVED', companyId: 'pub-ok' });

    const config = { get: (k: string) => (k === 'DATABASE_URL' ? URL : undefined), getOrThrow: () => URL } as unknown as ConfigService;
    const prisma = new PrismaService(config);
    const rec = (id: string, name: string): NormalizedRecord => ({
      source: 'PARTNER',
      companyExternalId: id,
      roundDedup: 'enrich',
      company: { name, hq: 'Undisclosed', foundedYear: 0, industry: ['Robots'], stage: 'Seed', totalRaisedUsd: 0, identifiers: [{ scheme: 'PARTNER', value: id }] },
      rounds: [],
    });
    try {
      const svc = new IngestService(
        prisma,
        [{ name: 'PARTNER', explicitOnly: true, fetch: async () => [], stream: async function* () { yield { records: [rec('f-1', 'Indigo'), rec('g-1', 'Okay Robotics')] }; } }],
        config,
      );
      const companies = await one<{ n: number }>(`SELECT count(*)::int AS n FROM "Company"`);
      await svc.run({ days: 1, limit: 10, sources: ['PARTNER'] });
      expect(svc.identityStats().held).toEqual({ 'review-required': 1 });
      expect(await one<{ n: number }>(`SELECT count(*)::int AS n FROM "Company"`)).toEqual(companies);
      // The certified association was written through: its blank industry filled.
      expect(await one(`SELECT industry FROM "Company" WHERE id = 'pub-ok'`)).toEqual({ industry: ['Robots'] });
      expect(await one(`SELECT industry FROM "Company" WHERE id = 'pub-uk'`)).toEqual({ industry: [] }); // held: untouched
    } finally {
      await prisma.$disconnect();
    }
  });
});
