/**
 * Investor focus against a REAL PostgreSQL: the v2 stage contract, the
 * targeted backfill's resolution (own row, domain, name-only, merge survivor,
 * non-investor), BigInt/date round-trips, idempotence and the stale rule.
 *
 * Run through `make test-investor-focus-integration`, which creates a
 * task-owned `capbase_repair_test_<pid>` database, migrates it, runs this suite
 * and drops it. The suite refuses any other database name.
 *
 * Synthetic records only: no licensed stage and no production data.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import { Client } from 'pg';

import { IngestService } from '../src/ingest/ingest.service';
import { PartnerInvestorFocusBackfill, focusPreflight } from '../src/ingest/partner-investor-focus';
import { PrismaService } from '../src/prisma/prisma.service';
import type { NormalizedInvestorFirm } from '../src/sources/ingestion-source';
import { PartnerClient } from '../src/sources/partner/partner.client';

const URL = process.env.REPAIR_TEST_DATABASE_URL ?? '';
const DB_NAME = URL ? new globalThis.URL(URL).pathname.slice(1) : '';
if (!/^capbase_repair_test_\w+$/.test(DB_NAME)) {
  throw new Error('REPAIR_TEST_DATABASE_URL must name a task-owned capbase_repair_test_* database (use make test-investor-focus-integration)');
}

let admin: Client;
let prisma: PrismaService;
let config: ConfigService;
const sql = async <T = Record<string, unknown>>(q: string, params: unknown[] = []) => (await admin.query(q, params)).rows as T[];

const INVESTOR_IDS = ['fx-own', 'fx-adv', 'fx-name', 'fx-lose', 'fx-win', 'fx-law'];
const IDENT_IDS = ['fx-i-own', 'fx-i-adv', 'fx-i-name', 'fx-i-lose'];

const investor = (id: string, over: { source?: string; externalId?: string; domain?: string; mergedInto?: string } = {}) =>
  sql(
    `INSERT INTO "Investor" (id, slug, name, type, domain, "externalSource", "externalId", "mergedIntoId", "moderationStatus", "updatedAt")
     VALUES ($1, $1, $1, 'Venture', $2, $3, $4, $5, 'APPROVED', now())`,
    [id, over.domain ?? null, over.source ?? null, over.externalId ?? null, over.mergedInto ?? null],
  );
const ident = (id: string, entityId: string, value: string) =>
  sql(`INSERT INTO "EntityIdentifier" (id, scheme, value, "entityType", "entityId", source) VALUES ($1, 'PARTNER', $2, 'investor', $3, 'PARTNER')`, [
    id,
    value,
    entityId,
  ]);

async function stage(): Promise<void> {
  await sql(`DROP SCHEMA IF EXISTS partner_stage CASCADE`);
  await sql(`CREATE SCHEMA partner_stage`);
  await sql(`CREATE TABLE partner_stage.firm (
    firm_id text PRIMARY KEY, name text NOT NULL, role text NOT NULL, manager_firm_type text, lp_firm_type text,
    country text, city text, website text, year_established int, about text, aum_usd numeric,
    vc_fund_share numeric, deal_count int NOT NULL DEFAULT 0)`);
  await sql(`CREATE TABLE partner_stage.firm_focus (
    firm_id text NOT NULL, role text NOT NULL, reported_on date,
    stages text[], main_strategy text, strategies text[], industries text[], verticals text[], geographies text[],
    range_min_usd_mn numeric, range_max_usd_mn numeric, range_min_local_mn numeric, range_max_local_mn numeric,
    range_currency text, PRIMARY KEY (firm_id, role))`);
  await sql(`CREATE TABLE partner_stage.meta AS SELECT 2 AS stage_version, DATE '2026-10-14' AS snapshot_date, now() AS built_at`);
  await sql(`INSERT INTO partner_stage.firm (firm_id, name, role, manager_firm_type, lp_firm_type, website, vc_fund_share, deal_count) VALUES
    ('F1', 'Own Capital',      'both',    'Venture Capital', 'Family Office - Single', 'https://own.example', 1, 3),
    ('F2', 'Domain Partners',  'manager', 'Venture Capital', NULL, 'www.dom.example', 1, 3),
    ('F3', 'Namesake Ventures','manager', 'Venture Capital', NULL, 'namesake-real.example', 1, 3),
    ('F4', 'Merged Capital',   'manager', 'Venture Capital', NULL, 'merged.example', 1, 3),
    ('F5', 'Law & Co',         'lp',      NULL, 'Law Firm', 'law.example', NULL, 0),
    ('F6', 'Unheld Ventures',  'manager', 'Venture Capital', NULL, 'unheld.example', 1, 3)`);
  await sql(`INSERT INTO partner_stage.firm_focus VALUES
    ('F1', 'manager', '2025-06-30', '{Seed,"Round B,C,D..."}', 'Venture Capital (All Stages)', '{"Early Stage"}',
       '{Software,Unknown,software,Healthcare}', '{Fintech}', '{US," ",Europe}', 1.5, 22.75, NULL, NULL, 'USD'),
    ('F1', 'lp', NULL, NULL, NULL, '{"Venture Capital"}', '{Software}', NULL, '{"North America"}', 0, 50, 0, 45, 'EUR'),
    ('F2', 'manager', '2025-01-15', '{Seed}', NULL, NULL, '{Software}', NULL, NULL, 0.5, 2, 0.45, 1.8, 'EUR'),
    ('F3', 'manager', '2025-01-15', '{Seed}', NULL, NULL, '{Software}', NULL, NULL, 1, 2, NULL, NULL, 'USD'),
    ('F4', 'manager', '2025-03-01', '{Follow-on}', NULL, NULL, '{Energy}', NULL, NULL, 5687059.32, NULL, NULL, NULL, 'USD'),
    ('F5', 'lp', '2025-03-01', NULL, NULL, '{Buyout}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    ('F6', 'manager', '2025-03-01', '{Seed}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`);
}

const backfill = () =>
  new PartnerInvestorFocusBackfill(prisma, new PartnerClient(prisma), new IngestService(prisma, [], config), () => {});

const focusOf = (investorId: string) =>
  sql<Record<string, unknown>>(
    `SELECT role, "externalId", stages, "mainStrategy", strategies, industries, verticals, geographies,
            "rangeMinUsd"::text AS "rangeMinUsd", "rangeMaxUsd"::text AS "rangeMaxUsd", "rangeCurrency",
            "rangeMinLocal"::text AS "rangeMinLocal", "rangeMaxLocal"::text AS "rangeMaxLocal",
            to_char("reportedOn", 'YYYY-MM-DD') AS "reportedOn", to_char("snapshotDate", 'YYYY-MM-DD') AS "snapshotDate"
       FROM "InvestorFocus" WHERE "investorId" = $1 ORDER BY role`,
    [investorId],
  );

beforeAll(async () => {
  admin = new Client({ connectionString: URL });
  await admin.connect();
  config = { get: (k: string) => (k === 'DATABASE_URL' ? URL : undefined), getOrThrow: () => URL } as unknown as ConfigService;
  prisma = new PrismaService(config);

  await investor('fx-own', { source: 'PARTNER', externalId: 'F1', domain: 'own.example' });
  await ident('fx-i-own', 'fx-own', 'F1');
  // Matched by domain: carries the partner id and the same identifying domain.
  await investor('fx-adv', { source: 'SEC_ADV', externalId: '801-1', domain: 'dom.example' });
  await ident('fx-i-adv', 'fx-adv', 'F2');
  // Matched by name only: carries the partner id, but its domain differs.
  await investor('fx-name', { source: 'SEC_ADV', externalId: '801-2', domain: 'namesake-other.example' });
  await ident('fx-i-name', 'fx-name', 'F3');
  // A partner firm an admin merged into a public one.
  await investor('fx-win', { source: 'SEC_ADV', externalId: '801-3', domain: 'winner.example' });
  await investor('fx-lose', { source: 'PARTNER', externalId: 'F4', domain: 'merged.example', mergedInto: 'fx-win' });
  await ident('fx-i-lose', 'fx-win', 'F4');
  // Staged, held, but not an investor type.
  await investor('fx-law', { source: 'PARTNER', externalId: 'F5', domain: 'law.example' });
  await stage();
}, 120_000);

afterAll(async () => {
  if (admin) {
    await sql(`DROP SCHEMA IF EXISTS partner_stage CASCADE`);
    await sql(`DELETE FROM "InvestorFocus" WHERE "externalSource" = 'PARTNER' AND "externalId" LIKE 'F%'`);
    await sql(`DELETE FROM "EntityIdentifier" WHERE id = ANY($1)`, [IDENT_IDS]);
    await sql(`UPDATE "Investor" SET "mergedIntoId" = NULL WHERE id = ANY($1)`, [INVESTOR_IDS]);
    await sql(`DELETE FROM "Investor" WHERE id = ANY($1) OR "externalId" = 'F7'`, [INVESTOR_IDS]);
    await admin.end();
  }
  await prisma?.$disconnect();
});

describe('targeted backfill', () => {
  it('the preflight accepts a complete v2 stage', async () => {
    expect(await focusPreflight(new PartnerClient(prisma))).toBeNull();
  });

  it('writes own, domain and survivor firms; refuses name-only and non-investor firms', async () => {
    const c = await backfill().run();
    expect(c).toMatchObject({ candidates: 6, written: 4, unchanged: 0, stale: 0, weak: 1, unresolved: 2 });
    expect(c.roles).toEqual({ manager: 5, lp: 2 });
    expect(c.issues['range-implausible']).toBe(1);
    expect(c.issues['labels-dropped']).toBe(1);

    expect(await focusOf('fx-own')).toEqual([
      {
        role: 'lp',
        externalId: 'F1:lp',
        stages: [],
        mainStrategy: null,
        strategies: ['Venture Capital'],
        industries: ['Software'],
        verticals: [],
        geographies: ['North America'],
        rangeMinUsd: null,
        rangeMaxUsd: '50000000',
        rangeCurrency: 'EUR',
        rangeMinLocal: null,
        rangeMaxLocal: '45000000',
        reportedOn: '2026-10-14',
        snapshotDate: '2026-10-14',
      },
      {
        role: 'manager',
        externalId: 'F1:manager',
        stages: ['Seed', 'Round B,C,D...'],
        mainStrategy: 'Venture Capital (All Stages)',
        strategies: ['Early Stage'],
        industries: ['Software', 'Healthcare'],
        verticals: ['Fintech'],
        geographies: ['US', 'Europe'],
        rangeMinUsd: '1500000',
        rangeMaxUsd: '22750000',
        rangeCurrency: 'USD',
        rangeMinLocal: null,
        rangeMaxLocal: null,
        reportedOn: '2025-06-30',
        snapshotDate: '2026-10-14',
      },
    ]);
    expect(await focusOf('fx-adv')).toEqual([
      expect.objectContaining({ role: 'manager', rangeMinUsd: '500000', rangeMaxUsd: '2000000', rangeCurrency: 'EUR', rangeMinLocal: '450000', rangeMaxLocal: '1800000' }),
    ]);
    // The implausible range is dropped; the labels still land, on the survivor.
    expect(await focusOf('fx-win')).toEqual([
      expect.objectContaining({ role: 'manager', externalId: 'F4:manager', industries: ['Energy'], rangeMinUsd: null, rangeMaxUsd: null }),
    ]);
    expect(await focusOf('fx-lose')).toEqual([]);
    expect(await focusOf('fx-name')).toEqual([]);
    expect(await focusOf('fx-law')).toEqual([]);
  });

  it('a second run writes nothing', async () => {
    const c = await backfill().run();
    expect(c).toMatchObject({ written: 0, unchanged: 4, weak: 1, unresolved: 2 });
  });

  it('an older snapshot of a role is stale and changes nothing', async () => {
    await sql(`UPDATE partner_stage.firm_focus SET reported_on = '2024-01-01', industries = '{Retail}' WHERE firm_id = 'F1' AND role = 'manager'`);
    const c = await backfill().run();
    expect(c).toMatchObject({ written: 0, stale: 1, unchanged: 3 });
    expect((await focusOf('fx-own')).find((r) => r.role === 'manager')).toMatchObject({ industries: ['Software', 'Healthcare'], reportedOn: '2025-06-30' });
  });

  it('refuses a v1 stage and names a missing column', async () => {
    const client = new PartnerClient(prisma);
    await sql(`ALTER TABLE partner_stage.meta RENAME TO meta_hidden`);
    try {
      expect(await focusPreflight(client)).toMatch(/v1.*load a v2 stage/);
    } finally {
      await sql(`ALTER TABLE partner_stage.meta_hidden RENAME TO meta`);
    }
    await sql(`ALTER TABLE partner_stage.firm_focus RENAME COLUMN range_currency TO range_ccy`);
    try {
      expect(await focusPreflight(client)).toMatch(/missing column\(s\): range_currency$/);
      await expect(client.requireFocusColumns()).rejects.toThrow(/range_currency/);
    } finally {
      await sql(`ALTER TABLE partner_stage.firm_focus RENAME COLUMN range_ccy TO range_currency`);
    }
    expect(await focusPreflight(client)).toBeNull();
  });
});

describe('firms-stage path', () => {
  it('IngestService.run writes a streamed firm’s focus once, then leaves it unchanged', async () => {
    const firm: NormalizedInvestorFirm = {
      externalId: 'F7',
      name: 'Streamed Ventures',
      type: 'Venture',
      domain: 'streamed.example',
      identifiers: [{ scheme: 'PARTNER', value: 'F7' }],
      focus: [
        {
          role: 'manager',
          stages: ['Seed'],
          mainStrategy: null,
          strategies: [],
          industries: ['Robotics'],
          verticals: [],
          geographies: ['US'],
          rangeMinUsd: 250_000,
          rangeMaxUsd: null,
          rangeCurrency: 'USD',
          rangeMinLocal: null,
          rangeMaxLocal: null,
          reportedOn: '2025-05-05',
          snapshotDate: '2026-10-14',
        },
      ],
    };
    const svc = new IngestService(
      prisma,
      [{ name: 'PARTNER', explicitOnly: true, fetch: async () => [], stream: async function* () { yield { investors: [firm] }; } }],
      config,
    );
    await svc.run({ days: 1, limit: 10, sources: ['PARTNER'] });
    const [created] = await sql<{ id: string }>(`SELECT id FROM "Investor" WHERE "externalSource" = 'PARTNER' AND "externalId" = 'F7'`);
    expect(created).toBeDefined();
    const first = await sql<{ updatedAt: Date; rangeMinUsd: string }>(
      `SELECT "updatedAt", "rangeMinUsd"::text AS "rangeMinUsd" FROM "InvestorFocus" WHERE "investorId" = $1`,
      [created!.id],
    );
    expect(first).toHaveLength(1);
    expect(first[0]!.rangeMinUsd).toBe('250000');

    await svc.run({ days: 1, limit: 10, sources: ['PARTNER'] });
    const second = await sql<{ updatedAt: Date }>(`SELECT "updatedAt" FROM "InvestorFocus" WHERE "investorId" = $1`, [created!.id]);
    expect(second.map((r) => r.updatedAt.getTime())).toEqual(first.map((r) => r.updatedAt.getTime()));
    // Clean up the streamed firm's dependants (identifier) before afterAll drops the firm.
    await sql(`DELETE FROM "EntityIdentifier" WHERE "entityId" = $1`, [created!.id]);
  });
});
