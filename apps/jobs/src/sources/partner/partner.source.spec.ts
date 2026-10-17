import { describe, expect, it } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';

import { FxTable } from '../../util/fx';
import type { SourceBatch } from '../ingestion-source';
import type { PartnerClient } from './partner.client';
import type { FirmRow } from './partner.parser';
import { PartnerSource, parseStages } from './partner.source';

const firm = (firm_id: string, over: Partial<FirmRow> = {}): FirmRow => ({
  firm_id,
  name: `Firm ${firm_id}`,
  role: 'manager',
  manager_firm_type: 'Private Equity Firm',
  lp_firm_type: null,
  country: 'US',
  city: null,
  website: null,
  year_established: null,
  about: null,
  aum_usd: null,
  vc_fund_share: 1,
  deal_count: 1,
  ...over,
});

/** A fake client over tiny in-memory stage tables, keyset-paged like the real one. */
function fakeClient(loaded = true): PartnerClient {
  const funds = [
    { fund_id: 'F1', manager_id: '501', name: 'Fund I', status: 'Closed', asset_class: 'Venture Capital' },
    { fund_id: 'F2', manager_id: 'law', name: 'Fund L', status: 'Closed', asset_class: 'Venture Capital' },
  ];
  const page = <T>(rows: T[], key: (r: T) => string, after: string, limit: number) =>
    rows.filter((r) => key(r) > after).slice(0, limit);
  return {
    stageLoaded: async () => loaded,
    allFirms: async () => [
      firm('501'),
      firm('777', { role: 'lp', manager_firm_type: null, lp_firm_type: 'Public Pension Fund' }),
      firm('law', { role: 'lp', manager_firm_type: null, lp_firm_type: 'Law Firm' }),
    ],
    people: async (ids: string[]) =>
      ids.includes('501')
        ? [{ contact_id: 'C1', firm_id: '501', name: 'Jane Doe', job_title: 'Partner', email: null, phone: null, linkedin: null }]
        : [],
    funds: async (after: string, limit: number) =>
      page(funds, (f) => f.fund_id, after, limit).map((f) => ({
        ...f,
        vintage: 2020,
        currency: 'USD',
        size_usd: 1,
        target_usd: null,
        hard_cap_usd: null,
        launch_date: null,
        latest_close_date: null,
        final_close_date: null,
        mgmt_fee_pct: null,
        carry_pct: null,
        hurdle_pct: null,
        irr_net_min: null,
        irr_net_max: null,
        irr_gross_min: null,
        irr_gross_max: null,
        region_focus: null,
        city: null,
        country: null,
      })),
    companies: async (after: string, limit: number) =>
      page(
        [{ company_id: 'PC1', name: 'Acme', country: 'US', city: null, website: null, industry: null, verticals: null, about: null, status: 'Active' }],
        (c) => c.company_id,
        after,
        limit,
      ),
    deals: async () => [
      { deal_id: 'D1', company_id: 'PC1', deal_date: '2021-01-01', stage: 'Seed', status: 'Completed', currency: 'USD', size_local: 1, size_usd: 1 },
    ],
    dealInvestors: async () => [{ deal_id: 'D1', firm_id: '501' }],
    commitments: async (after: [string, string], limit: number) =>
      [
        { fund_id: 'F1', firm_id: '777', amount_local: 5, fund_name: 'Fund I', manager_id: '501', fund_currency: 'USD', vintage: 2020 },
        { fund_id: 'F1', firm_id: 'law', amount_local: 5, fund_name: 'Fund I', manager_id: '501', fund_currency: 'USD', vintage: 2020 },
      ].filter((c) => `${c.fund_id}\u0000${c.firm_id}` > `${after[0]}\u0000${after[1]}`).slice(0, limit),
    metrics: async (after: [string, string], limit: number) =>
      [{ fund_id: 'F1', as_at: '2024-06-30', dry_powder_local: null, aum_usd: 9, unrealized_local: null, fund_name: 'Fund I', manager_id: '501', fund_currency: 'USD' }]
        .filter((m) => `${m.fund_id}\u0000${m.as_at}` > `${after[0]}\u0000${after[1]}`)
        .slice(0, limit),
  } as unknown as PartnerClient;
}

function source(env: Record<string, string> = {}, loaded = true) {
  const s = new PartnerSource(fakeClient(loaded), { get: (k: string) => env[k] } as unknown as ConfigService);
  s.fxLoader = async () => FxTable.parse('Date,USD,\n2020-01-02,1.1,\n');
  return s;
}

async function collect(s: PartnerSource, limit = 1_000_000): Promise<SourceBatch[]> {
  const out: SourceBatch[] = [];
  for await (const b of s.stream({ days: 1, limit })) out.push(b);
  return out;
}

const kinds = (batches: SourceBatch[]) =>
  batches.map((b) => Object.keys(b).filter((k) => (b[k as keyof SourceBatch]?.length ?? 0) > 0)).flat();

describe('PartnerSource', () => {
  it('yields firms → funds → records → commitments → metrics', async () => {
    expect(kinds(await collect(source()))).toEqual(['investors', 'funds', 'records', 'commitments', 'metrics']);
  });

  it('drops non-investor firms and cascades the drop to their funds and commitments', async () => {
    const batches = await collect(source());
    const firms = batches.flatMap((b) => b.investors ?? []);
    expect(firms.map((f) => f.externalId)).toEqual(['501', '777']);
    expect(firms[0]!.people).toHaveLength(1);
    expect(batches.flatMap((b) => b.funds ?? []).map((f) => f.externalId)).toEqual(['F1']);
    expect(batches.flatMap((b) => b.commitments ?? []).map((c) => c.externalId)).toEqual(['F1:777']);
  });

  it('runs only the stages PARTNER_STAGES names', async () => {
    expect(kinds(await collect(source({ PARTNER_STAGES: 'funds' })))).toEqual(['funds']);
    expect(kinds(await collect(source({ PARTNER_STAGES: 'commitments, metrics' })))).toEqual([
      'commitments',
      'metrics',
    ]);
  });

  it('yields nothing when the stage schema is not loaded', async () => {
    expect(await collect(source({}, false))).toEqual([]);
  });

  it('is never fetched and never part of an "all sources" run', async () => {
    const s = source();
    expect(await s.fetch()).toEqual([]);
    expect(s.explicitOnly).toBe(true);
  });
});

describe('parseStages', () => {
  it('defaults to every stage', () => {
    expect([...parseStages(undefined)]).toEqual(['firms', 'funds', 'companies', 'commitments', 'metrics']);
    expect([...parseStages(' ')]).toHaveLength(5);
  });

  it('rejects a typo rather than silently running nothing', () => {
    expect(() => parseStages('firm')).toThrow(/Unknown PARTNER_STAGES/);
  });
});
