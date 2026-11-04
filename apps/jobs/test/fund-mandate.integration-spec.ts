/**
 * The fund mandate against a REAL PostgreSQL: the v3 stage contract and its
 * preflight, the real PartnerSource → IngestService funds stage (create, own
 * key, name-and-manager enrichment), list columns, provenance marks,
 * idempotence, the older-snapshot guard and a v2 stage.
 *
 * Run through `make test-fund-mandate-integration`, which creates a task-owned
 * `capbase_repair_test_<pid>` database, migrates it, runs this suite and drops
 * it. The suite refuses any other database name.
 *
 * Synthetic records only: no licensed stage and no production data.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import { Client } from 'pg';

import { IngestService } from '../src/ingest/ingest.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PartnerClient } from '../src/sources/partner/partner.client';
import { PartnerSource } from '../src/sources/partner/partner.source';

const URL = process.env.REPAIR_TEST_DATABASE_URL ?? '';
const DB_NAME = URL ? new globalThis.URL(URL).pathname.slice(1) : '';
if (!/^capbase_repair_test_\w+$/.test(DB_NAME)) {
  throw new Error('REPAIR_TEST_DATABASE_URL must name a task-owned capbase_repair_test_* database (use make test-fund-mandate-integration)');
}

let admin: Client;
let prisma: PrismaService;
let config: ConfigService;
const sql = async <T = Record<string, unknown>>(q: string, params: unknown[] = []) => (await admin.query(q, params)).rows as T[];

const MANAGER = 'fm-mgr';

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
  await sql(`CREATE TABLE partner_stage.fund (
    fund_id text PRIMARY KEY, manager_id text NOT NULL, name text NOT NULL, status text, asset_class text,
    vintage int, currency text, size_usd numeric, target_usd numeric, hard_cap_usd numeric,
    launch_date date, latest_close_date date, final_close_date date, mgmt_fee_pct numeric, carry_pct numeric,
    hurdle_pct numeric, irr_net_min numeric, irr_net_max numeric, irr_gross_min numeric, irr_gross_max numeric,
    region_focus text, city text, country text)`);
  await sql(`CREATE TABLE partner_stage.fund_mandate (
    fund_id text PRIMARY KEY, detailed_strategy text, industries text[], verticals text[],
    geographic_focus text[], geographic_exposure text[], domicile text, structure text, legal_structure text)`);
  await sql(`CREATE TABLE partner_stage.meta AS SELECT 3 AS stage_version, DATE '2026-10-14' AS snapshot_date, now() AS built_at`);
  await sql(`INSERT INTO partner_stage.firm (firm_id, name, role, manager_firm_type, vc_fund_share, deal_count)
             VALUES ('M1', 'Mandate Capital', 'manager', 'Venture Capital', 1, 3)`);
  await sql(`INSERT INTO partner_stage.fund (fund_id, manager_id, name, status, asset_class, vintage, region_focus) VALUES
    ('PF1', 'M1', 'Mandate Venture Fund I',  'Closed', 'Venture Capital', 2021, 'North America'),
    ('PF2', 'M1', 'Adv Matched Fund II',     'Closed', 'Venture Capital', 2019, 'Europe'),
    ('PF3', 'M1', 'Preset Domicile Fund III','Closed', 'Venture Capital', 2018, NULL)`);
  await sql(`INSERT INTO partner_stage.fund_mandate VALUES
    ('PF1', 'Early Stage: Seed', '{"Automobiles, Other Vehicles & Parts",Software,Diversified}', '{Fintech}',
       '{"North America"}', '{"North America","Hong Kong SAR - China SAR - China",Other}', 'Delaware', 'Commingled', 'Limited Partnership'),
    ('PF2', 'Buyout', '{Healthcare}', NULL, '{Europe}', '{Europe}', 'Luxembourg', 'Commingled', 'Luxembourg SCSp'),
    ('PF3', NULL, '{Energy}', NULL, NULL, NULL, 'Delaware', 'Separately Managed Account', 'Commingled')`);
}

const service = () =>
  new IngestService(
    prisma,
    [
      new PartnerSource(new PartnerClient(prisma), {
        get: (k: string) => (k === 'PARTNER_STAGES' ? 'funds' : undefined),
      } as unknown as ConfigService),
    ],
    config,
  );
const run = (svc = service()) => svc.run({ days: 1, limit: 1_000, sources: ['PARTNER'] });

/** The manager's funds, every column but `updatedAt`, hashed in id order. */
const fingerprint = async () =>
  (
    await sql<{ md5: string }>(
      `SELECT md5(string_agg((to_jsonb(f) - 'updatedAt')::text, '' ORDER BY id)) AS md5 FROM "Fund" f WHERE "managerId" = $1`,
      [MANAGER],
    )
  )[0]!.md5;

const mandateOf = async (where: string, params: unknown[]) =>
  (
    await sql<Record<string, unknown>>(
      `SELECT "detailedStrategy", industries, verticals, "geographicFocus", "geographicExposure", domicile, structure,
              "legalStructure", to_char("mandateReportedOn", 'YYYY-MM-DD') AS "reportedOn", "partnerFields", "partnerOnly"
         FROM "Fund" WHERE ${where}`,
      params,
    )
  )[0];

beforeAll(async () => {
  admin = new Client({ connectionString: URL });
  await admin.connect();
  config = { get: (k: string) => (k === 'DATABASE_URL' ? URL : undefined), getOrThrow: () => URL } as unknown as ConfigService;
  prisma = new PrismaService(config);

  await sql(
    `INSERT INTO "Investor" (id, slug, name, type, "externalSource", "externalId", "moderationStatus", "updatedAt")
     VALUES ($1, $1, 'Mandate Capital', 'Venture', 'PARTNER', 'M1', 'APPROVED', now())`,
    [MANAGER],
  );
  await sql(
    `INSERT INTO "Fund" (id, slug, name, "managerId", "externalSource", "externalId", "moderationStatus", domicile, "updatedAt") VALUES
       ('fm-adv',    'fm-adv',    'Adv Matched Fund II, L.P.',      $1, 'SEC_ADV_FUNDS', '805-0000000001', 'APPROVED', NULL, now()),
       ('fm-preset', 'fm-preset', 'Preset Domicile Fund III, L.P.', $1, 'SEC_ADV_FUNDS', '805-0000000002', 'APPROVED', 'Cayman Islands', now())`,
    [MANAGER],
  );
  await stage();
}, 120_000);

afterAll(async () => {
  if (admin) {
    await sql(`DROP SCHEMA IF EXISTS partner_stage CASCADE`);
    await sql(`DELETE FROM "Fund" WHERE "managerId" = $1`, [MANAGER]);
    await sql(`DELETE FROM "Investor" WHERE id = $1`, [MANAGER]);
    await admin.end();
  }
  await prisma?.$disconnect();
});

describe('funds stage on a v3 stage', () => {
  it('creates the partner fund with the exact cleaned labels and the snapshot date', async () => {
    await run();
    expect(await mandateOf(`"externalSource" = 'PARTNER' AND "externalId" = 'PF1'`, [])).toEqual({
      detailedStrategy: 'Early Stage: Seed',
      industries: ['Automobiles, Other Vehicles & Parts', 'Software', 'Diversified'],
      verticals: ['Fintech'],
      geographicFocus: ['North America'],
      geographicExposure: ['North America', 'Hong Kong SAR - China'],
      domicile: 'Delaware',
      structure: 'Commingled',
      legalStructure: 'Limited Partnership',
      reportedOn: '2026-10-14',
      partnerFields: expect.arrayContaining(['industries', 'verticals', 'geographicExposure', 'mandateReportedOn', 'regionFocus']),
      partnerOnly: true,
    });
  });

  it('fills the enriched ADV fund and marks what it filled', async () => {
    const adv = await mandateOf(`id = $1`, ['fm-adv']);
    expect(adv).toMatchObject({
      detailedStrategy: 'Buyout',
      industries: ['Healthcare'],
      verticals: [],
      geographicFocus: ['Europe'],
      domicile: 'Luxembourg',
      legalStructure: 'Luxembourg SCSp',
      reportedOn: '2026-10-14',
      partnerOnly: false,
    });
    expect([...(adv!.partnerFields as string[])].sort()).toEqual(
      [
        'detailedStrategy',
        'domicile',
        'geographicExposure',
        'geographicFocus',
        'industries',
        'legalStructure',
        'mandateReportedOn',
        'regionFocus',
        'status',
        'strategy',
        'structure',
        'vintageYear',
      ].sort(),
    );
    // Not created twice: the partner fund matched the ADV row.
    expect(await sql(`SELECT 1 FROM "Fund" WHERE "externalSource" = 'PARTNER' AND "externalId" = 'PF2'`)).toEqual([]);
  });

  it('keeps a domicile the ADV fund already holds, and drops a misfiled legal structure', async () => {
    const preset = await mandateOf(`id = $1`, ['fm-preset']);
    expect(preset).toMatchObject({
      domicile: 'Cayman Islands',
      structure: 'Separately Managed Account',
      legalStructure: null,
      industries: ['Energy'],
    });
    expect(preset!.partnerFields).not.toContain('domicile');
    expect(preset!.partnerFields).not.toContain('legalStructure');
  });

  it('a second run changes nothing', async () => {
    const before = await fingerprint();
    await run();
    expect(await fingerprint()).toBe(before);
  });

  it('an older snapshot leaves every mandate unchanged and is counted stale', async () => {
    const before = await fingerprint();
    await sql(`UPDATE partner_stage.meta SET snapshot_date = DATE '2026-01-01'`);
    await sql(`UPDATE partner_stage.fund_mandate SET industries = '{Retail}' WHERE fund_id = 'PF1'`);
    try {
      const svc = service();
      await run(svc);
      expect(svc.identityStats().fundMandateStale).toBe(3);
      expect(await fingerprint()).toBe(before);
    } finally {
      await sql(`UPDATE partner_stage.meta SET snapshot_date = DATE '2026-10-14'`);
      await sql(
        `UPDATE partner_stage.fund_mandate SET industries = '{"Automobiles, Other Vehicles & Parts",Software,Diversified}' WHERE fund_id = 'PF1'`,
      );
    }
  });

  it('a v3 stage missing a contract column throws naming it, before any write', async () => {
    const before = await fingerprint();
    const updated = await sql<{ max: Date }>(`SELECT max("updatedAt") AS max FROM "Fund" WHERE "managerId" = $1`, [MANAGER]);
    await sql(`ALTER TABLE partner_stage.fund_mandate RENAME COLUMN legal_structure TO legal_form`);
    try {
      await expect(run()).rejects.toThrow(/legal_structure/);
      expect(await fingerprint()).toBe(before);
      const after = await sql<{ max: Date }>(`SELECT max("updatedAt") AS max FROM "Fund" WHERE "managerId" = $1`, [MANAGER]);
      expect(after[0]!.max.getTime()).toBe(updated[0]!.max.getTime());
    } finally {
      await sql(`ALTER TABLE partner_stage.fund_mandate RENAME COLUMN legal_form TO legal_structure`);
    }
  });

  it('a v2 stage runs the funds stage and writes no mandate', async () => {
    // Clear the mandate everywhere, then run on a v2 stage (no fund_mandate).
    await sql(
      `UPDATE "Fund" SET "detailedStrategy" = NULL, industries = '{}', verticals = '{}', "geographicFocus" = '{}',
              "geographicExposure" = '{}', domicile = CASE WHEN id = 'fm-preset' THEN domicile END, structure = NULL,
              "legalStructure" = NULL, "mandateReportedOn" = NULL WHERE "managerId" = $1`,
      [MANAGER],
    );
    await sql(`DROP TABLE partner_stage.fund_mandate`);
    await sql(`UPDATE partner_stage.meta SET stage_version = 2`);
    await run();
    const rows = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM "Fund"
        WHERE "managerId" = $1 AND ("mandateReportedOn" IS NOT NULL OR cardinality(industries) > 0 OR "detailedStrategy" IS NOT NULL)`,
      [MANAGER],
    );
    expect(rows[0]!.n).toBe(0);
    // The funds stage itself still ran: the partner fund exists and kept its region.
    expect(await sql(`SELECT "regionFocus" FROM "Fund" WHERE "externalSource" = 'PARTNER' AND "externalId" = 'PF1'`)).toEqual([
      { regionFocus: 'North America' },
    ]);
  });
});
