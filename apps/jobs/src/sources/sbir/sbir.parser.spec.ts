import { describe, it, expect } from '@jest/globals';

import type { SbirRow } from './sbir.client';
import { SbirAggregator, firmKey } from './sbir.parser';

/** Column names and values copied from the real award file. */
function award(overrides: Partial<SbirRow> = {}): SbirRow {
  return {
    Company: 'BUSEK CO., INC.',
    'Award Title': 'Compact Stored Propellant Propulsion System for VLEO Satellites',
    Agency: 'Department of Defense',
    Branch: 'Air Force',
    Phase: 'Phase II',
    Program: 'SBIR',
    'Agency Tracking Number': 'F2D-19027',
    Contract: 'FA2541-26-C-B007',
    'Proposal Award Date': '2026-01-23',
    'Award Year': '2026',
    'Award Amount': '1699936.2400',
    UEI: 'SATYSBWG3FL7',
    Duns: '184629491',
    'Number Employees': '110',
    'Company Website': 'http://www.busek.com',
    City: 'NATICK',
    State: 'Massachusetts',
    'Contact Name': 'David  Bilyeu',
    'Contact Title': 'Chief Executive Officer',
    'PI Name': 'James  Szabo',
    ...overrides,
  };
}

function records(rows: SbirRow[], minYear = 2015) {
  const aggregator = new SbirAggregator(minYear);
  for (const row of rows) aggregator.add(row);
  return aggregator.records();
}

describe('firmKey', () => {
  it('prefers UEI, then DUNS, then the normalized name', () => {
    expect(firmKey(award())).toBe('uei:SATYSBWG3FL7');
    expect(firmKey(award({ UEI: '' }))).toBe('duns:184629491');
    expect(firmKey(award({ UEI: '', Duns: '' }))).toBe('name:busek co inc');
  });

  it('matches two awards of one firm across a name change', () => {
    // 17,161 distinct UEIs, none of which span more than one firm — so the UEI
    // is authoritative even when the typed name drifts.
    expect(firmKey(award({ Company: 'Busek Company Inc' }))).toBe(firmKey(award()));
  });
});

describe('SbirAggregator', () => {
  it('maps a firm and its award, with the award as a Grant', () => {
    const [record] = records([award()]);

    expect(record!.source).toBe('SBIR');
    expect(record!.companyExternalId).toBe('uei:SATYSBWG3FL7');
    expect(record!.company).toMatchObject({
      name: 'BUSEK CO., INC.',
      hq: 'NATICK, Massachusetts',
      headcount: 110,
      domain: 'busek.com',
      stage: 'Seed',
      status: 'Private',
      // Grant money is not raised capital, and this column is what the tape sums.
      totalRaisedUsd: 0,
      foundedYear: 0,
    });
    expect(record!.company.industry).toEqual(['Department of Defense', 'Air Force']);
    expect(record!.rounds).toEqual([
      {
        externalId: 'uei:SATYSBWG3FL7:FA2541-26-C-B007',
        name: 'SBIR Phase II award (DOD)',
        date: '2026-01-23',
        amountUsd: 1_699_936.24,
        kind: 'Grant',
      },
    ]);
  });

  it('keeps a firm on any recent award, then ingests its whole history', () => {
    const old = award({
      Contract: 'OLD-1',
      'Award Year': '2004',
      'Proposal Award Date': '2004-06-01',
      'Award Amount': '99000',
    });
    const [record] = records([old, award()], 2015);

    expect(record!.rounds).toHaveLength(2);
    // Newest first, like every other funding ladder.
    expect(record!.rounds!.map((r) => r.date)).toEqual(['2026-01-23', '2004-06-01']);
  });

  it('drops a firm whose every award predates the window', () => {
    const old = award({ 'Award Year': '2004', 'Proposal Award Date': '2004-06-01' });
    expect(records([old], 2015)).toEqual([]);
    expect(records([old], 1983)).toHaveLength(1);
  });

  it('takes the firm facts from its newest award', () => {
    const stale = award({
      'Award Year': '2016',
      'Proposal Award Date': '2016-02-01',
      Contract: 'OLD-2',
      'Number Employees': '4',
      City: 'CAMBRIDGE',
    });
    const [record] = records([stale, award()]);
    expect(record!.company.headcount).toBe(110);
    expect(record!.company.hq).toBe('NATICK, Massachusetts');
  });

  it('every emitted round is a Grant, whatever the program or phase', () => {
    const rows = records([
      award(),
      award({ Contract: 'C2', Program: 'STTR', Phase: 'Phase I', 'Award Amount': '150000' }),
    ]);
    expect(rows[0]!.rounds!.every((r) => r.kind === 'Grant')).toBe(true);
    expect(rows[0]!.rounds!.map((r) => r.name)).toContain('STTR Phase I award (DOD)');
    expect(rows[0]!.company.totalRaisedUsd).toBe(0);
  });

  it('falls back to the tracking number when no contract is recorded', () => {
    const [record] = records([award({ Contract: '' })]);
    expect(record!.rounds![0]!.externalId).toBe('uei:SATYSBWG3FL7:F2D-19027');
  });

  it('dates an award with no proposal date to its award year', () => {
    const [record] = records([award({ 'Proposal Award Date': '' })]);
    expect(record!.rounds![0]!.date).toBe('2026-01-01');
  });

  it('skips an award with no amount', () => {
    const [record] = records([award({ 'Award Amount': '' }), award({ Contract: 'C2' })]);
    expect(record!.rounds).toHaveLength(1);
  });

  it('takes a company contact but never the principal investigator', () => {
    const [record] = records([award()]);
    expect(record!.people).toEqual([
      {
        externalId: 'uei:SATYSBWG3FL7:person:david-bilyeu',
        name: 'David Bilyeu',
        role: 'Chief Executive Officer',
        title: 'Chief Executive Officer',
        since: 2026,
      },
    ]);
  });

  it('takes no person when the contact has no title', () => {
    // 'Contact Name' is blank or untitled on most awards; a name with no role
    // is not a fact worth publishing.
    expect(records([award({ 'Contact Title': '' })])[0]!.people).toEqual([]);
    expect(records([award({ 'Contact Name': '  ' })])[0]!.people).toEqual([]);
  });

  it('publishes no domain for a platform-hosted website', () => {
    const [record] = records([award({ 'Company Website': 'https://sites.google.com/x' })]);
    expect(record!.company.domain).toBeUndefined();
  });

  it('classifies by award title first, then by the funding agency', () => {
    // DoD funds every sector, so its awards must be classified by their titles.
    const bio = records([
      award({ 'Award Title': 'Portable medical diagnostics for forward field hospitals' }),
    ])[0]!;
    expect(bio.company.primarySector).toBe('Healthcare');

    // An agency with one mission classifies its own awards.
    const energy = records([
      award({ Agency: 'Department of Energy', 'Award Title': 'Widget assembly rig' }),
    ])[0]!;
    expect(energy.company.primarySector).toBe('Energy');

    // Neither signal fires: honestly unclassified.
    const unknown = records([
      award({ Agency: 'Department of Defense', 'Award Title': 'Widget assembly rig' }),
    ])[0]!;
    expect(unknown.company.primarySector).toBeNull();
  });
});
