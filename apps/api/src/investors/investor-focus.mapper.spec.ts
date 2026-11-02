import { describe, expect, it } from '@jest/globals';
import type { InvestorFocus as DbInvestorFocus } from '@repo/db';

import { toInvestorFocus } from './investor-focus.mapper';

const row = (over: Partial<DbInvestorFocus> = {}): DbInvestorFocus => ({
  id: 'foc-1',
  investorId: 'i-1',
  role: 'manager',
  stages: ['Seed'],
  mainStrategy: 'Venture Capital',
  strategies: ['Early Stage'],
  industries: ['Software'],
  verticals: ['Fintech'],
  geographies: ['US'],
  rangeMinUsd: 1_000_000n,
  rangeMaxUsd: 5_000_000n,
  rangeCurrency: 'USD',
  rangeMinLocal: null,
  rangeMaxLocal: null,
  reportedOn: new Date('2025-06-30T00:00:00.000Z'),
  snapshotDate: new Date('2026-10-14T00:00:00.000Z'),
  externalSource: 'PARTNER',
  externalId: 'P1:manager',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('toInvestorFocus', () => {
  it('maps a manager-only firm', () => {
    expect(toInvestorFocus([row()])).toEqual({
      manager: {
        stages: ['Seed'],
        mainStrategy: 'Venture Capital',
        strategies: ['Early Stage'],
        industries: ['Software'],
        verticals: ['Fintech'],
        geographicExposure: ['US'],
        initialEquityInvestment: { minUsd: 1_000_000, maxUsd: 5_000_000, currency: 'USD', minLocal: null, maxLocal: null },
        reportedOn: '2025-06-30',
      },
      lp: null,
    });
  });

  it('maps an LP-only firm under its own field names', () => {
    expect(toInvestorFocus([row({ role: 'lp', stages: [], mainStrategy: null, externalId: 'P1:lp' })])).toEqual({
      manager: null,
      lp: {
        strategyPreferences: ['Early Stage'],
        industries: ['Software'],
        verticals: ['Fintech'],
        geographicPreferences: ['US'],
        typicalCommitment: { minUsd: 1_000_000, maxUsd: 5_000_000, currency: 'USD', minLocal: null, maxLocal: null },
        reportedOn: '2025-06-30',
      },
    });
  });

  it('maps both roles', () => {
    const f = toInvestorFocus([row(), row({ id: 'foc-2', role: 'lp', externalId: 'P1:lp' })]);
    expect(f?.manager).not.toBeNull();
    expect(f?.lp).not.toBeNull();
  });

  it('keeps the first row of a duplicated role (the read orders newest first)', () => {
    const f = toInvestorFocus([
      row({ industries: ['Newest'] }),
      row({ id: 'foc-2', industries: ['Older'], externalId: 'P2:manager' }),
    ]);
    expect(f?.manager?.industries).toEqual(['Newest']);
  });

  it('reads an empty range as null', () => {
    expect(toInvestorFocus([row({ rangeMinUsd: null, rangeMaxUsd: null })])?.manager?.initialEquityInvestment).toBeNull();
  });

  it('gives a USD range no local bounds, and keeps a EUR range’s', () => {
    expect(
      toInvestorFocus([row({ rangeMinLocal: 9n, rangeMaxLocal: 9n })])?.manager?.initialEquityInvestment,
    ).toMatchObject({ currency: 'USD', minLocal: null, maxLocal: null });
    expect(
      toInvestorFocus([row({ rangeCurrency: 'EUR', rangeMinLocal: 900_000n, rangeMaxLocal: 4_500_000n })])?.manager
        ?.initialEquityInvestment,
    ).toEqual({ minUsd: 1_000_000, maxUsd: 5_000_000, currency: 'EUR', minLocal: 900_000, maxLocal: 4_500_000 });
  });

  it('is null with no rows', () => {
    expect(toInvestorFocus([])).toBeNull();
  });
});
