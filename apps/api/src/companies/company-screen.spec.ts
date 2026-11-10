import { describe, expect, it } from '@jest/globals';
import { DEFAULT_GATE_POLICY, type ViewerAccess } from '@repo/api';

import { directoryFilters } from '../gate/gate';
import { INVESTOR_LINK_CAP, companyScreenWhere, investorLinkReads, roundCriteriaWhere, type ScreenInputs } from './company-screen';

const base = { unlockedUntil: null, admin: false, windowDays: 30 };
const signedOut: ViewerAccess = { ...base, unlocked: false, signedIn: false };
const unlocked: ViewerAccess = { ...base, unlocked: true, signedIn: true };
const P = DEFAULT_GATE_POLICY;

const NOT_PARTNER = { OR: [{ externalSource: null }, { externalSource: { not: 'PARTNER' } }] };
const from = new Date('2025-11-10T00:00:00Z');
const toExclusive = new Date('2026-11-10T12:00:00Z');

const inputs = (over: Partial<ScreenInputs> & { access?: ViewerAccess }): ScreenInputs => {
  const access = over.access ?? unlocked;
  return {
    query: {},
    dir: directoryFilters(P, 'company', access, { round: true, investor: true, raised: true }),
    window: null,
    investorIds: null,
    investorScope: null,
    ...over,
  };
};

describe('companyScreenWhere', () => {
  it('is empty when nothing applies', () => {
    expect(companyScreenWhere(inputs({}))).toEqual([]);
  });

  it('puts every round criterion in ONE rounds.some (same-round semantics)', () => {
    const and = companyScreenWhere(
      inputs({
        query: { roundKind: 'Equity', roundWithin: '12m', roundMin: 1_000_000, roundMax: 20_000_000 },
        window: { from, toExclusive },
      }),
    );
    expect(and).toEqual([
      {
        rounds: {
          some: {
            moderationStatus: 'APPROVED',
            kind: 'Equity',
            date: { gte: from, lt: toExclusive },
            amountUsd: { gt: BigInt(0), gte: BigInt(1_000_000), lte: BigInt(20_000_000) },
          },
        },
      },
    ]);
  });

  it('keeps the unknown sentinel out of every scale bound', () => {
    expect(companyScreenWhere(inputs({ query: { raisedMax: 5_000_000 } }))).toEqual([
      { totalRaisedUsd: { gt: BigInt(0), lte: BigInt(5_000_000) } },
    ]);
    expect(companyScreenWhere(inputs({ query: { raisedMin: 0 } }))).toEqual([
      { totalRaisedUsd: { gt: BigInt(0), gte: BigInt(0) } },
    ]);
    expect(companyScreenWhere(inputs({ query: { valuationMin: 1 } }))).toEqual([
      { lastValuationUsd: { not: null, gt: BigInt(0), gte: BigInt(1) } },
    ]);
    expect(companyScreenWhere(inputs({ query: { foundedMax: 2100, headcountMin: 10 } }))).toEqual([
      { founded: { gt: 0, lte: 2100 } },
      { headcount: { gt: 0, gte: 10 } },
    ]);
  });

  it('emits nothing for a locked round filter', () => {
    const i = inputs({ access: signedOut, query: { roundKind: 'Equity' }, window: { from, toExclusive } });
    expect(i.dir.use('round')).toBe(false);
    expect(companyScreenWhere(i)).toEqual([]);
    expect(roundCriteriaWhere(i)).toBeNull();
  });

  it('matches nothing for an unresolved investor', () => {
    expect(companyScreenWhere(inputs({ query: { investor: 'x' }, investorIds: [], investorScope: 'holdingsAndRounds' }))).toEqual([
      { id: { in: [] } },
    ]);
  });

  it('puts the investor inside the round predicate for the `round` scope', () => {
    const i = inputs({
      query: { investor: 'j', investorOn: 'round', roundKind: 'Equity' },
      investorIds: ['inv1'],
      investorScope: 'round',
    });
    expect(companyScreenWhere(i)).toEqual([
      {
        rounds: {
          some: { moderationStatus: 'APPROVED', kind: 'Equity', investors: { some: { investorId: { in: ['inv1'] } } } },
        },
      },
    ]);
    // With no other round criterion: "named on any approved round".
    expect(roundCriteriaWhere({ ...i, query: { investor: 'j', investorOn: 'round' } })).toEqual({
      moderationStatus: 'APPROVED',
      investors: { some: { investorId: { in: ['inv1'] } } },
    });
  });

  it('matches holdings or round participation for the default scope, and holdings only when rounds are locked', () => {
    const any = companyScreenWhere(
      inputs({ query: { investor: 'j' }, investorIds: ['inv1'], investorScope: 'holdingsAndRounds' }),
    );
    expect(any).toEqual([
      {
        OR: [
          { investors: { some: { investorId: { in: ['inv1'] }, moderationStatus: 'APPROVED' } } },
          {
            rounds: {
              some: { moderationStatus: 'APPROVED', investors: { some: { investorId: { in: ['inv1'] } } } },
            },
          },
        ],
      },
    ]);
    // Pre-resolved links replace the OR (which no index serves).
    expect(
      companyScreenWhere(
        inputs({ query: { investor: 'j' }, investorIds: ['inv1'], investorScope: 'holdingsAndRounds', investorCompanyIds: ['c1', 'c2'] }),
      ),
    ).toEqual([{ id: { in: ['c1', 'c2'] } }]);
    const holdings = companyScreenWhere(inputs({ query: { investor: 'j' }, investorIds: ['inv1'], investorScope: 'holdings' }));
    expect(holdings).toEqual([{ investors: { some: { investorId: { in: ['inv1'] }, moderationStatus: 'APPROVED' } } }]);
    expect(JSON.stringify(holdings)).not.toContain('rounds');
  });

  it('keeps partner rows and partner-corrected criterion columns out below the partner audience', () => {
    // An admin-style `use` with the signed-out row filter: the builder only reads `dir`.
    const dir = directoryFilters(P, 'company', signedOut, {});
    const i: ScreenInputs = {
      query: { roundKind: 'Equity', roundMin: 1 },
      dir: { ...dir, use: () => true },
      window: { from },
      investorIds: ['inv1'],
      investorScope: 'holdingsAndRounds',
    };
    const and = companyScreenWhere(i);
    expect(and[0]).toEqual({
      rounds: {
        some: {
          moderationStatus: 'APPROVED',
          ...NOT_PARTNER,
          kind: 'Equity',
          date: { gte: from },
          amountUsd: { gt: BigInt(0), gte: BigInt(1) },
          AND: [
            { NOT: { partnerFields: { has: 'kind' } } },
            { NOT: { partnerFields: { has: 'date' } } },
            { NOT: { partnerFields: { has: 'amountUsd' } } },
          ],
        },
      },
    });
    expect(and[1]).toEqual({
      OR: [
        { investors: { some: { investorId: { in: ['inv1'] }, moderationStatus: 'APPROVED', ...NOT_PARTNER } } },
        {
          rounds: {
            some: {
              moderationStatus: 'APPROVED',
              ...NOT_PARTNER,
              investors: { some: { investorId: { in: ['inv1'] }, ...NOT_PARTNER } },
            },
          },
        },
      ],
    });
  });
});

describe('investorLinkReads', () => {
  it('reads both branches with their section row filters, capped one past the limit', () => {
    const reads = investorLinkReads(directoryFilters(P, 'company', signedOut, {}), ['inv1']);
    expect(reads.holdings).toEqual({
      where: { investorId: { in: ['inv1'] }, moderationStatus: 'APPROVED', ...NOT_PARTNER },
      select: { companyId: true },
      take: INVESTOR_LINK_CAP + 1,
    });
    expect(reads.rounds).toEqual({
      where: { moderationStatus: 'APPROVED', ...NOT_PARTNER, investors: { some: { investorId: { in: ['inv1'] }, ...NOT_PARTNER } } },
      select: { companyId: true },
      take: INVESTOR_LINK_CAP + 1,
    });
  });
});
