import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import { FundsService, fundOrderBy } from './funds.service';
import { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';

/** Gate-neutral by default: an unlocked viewer sees what these tests describe. */
const unlockedUsers = { accessFor: async () => ({ unlocked: true, signedIn: true, unlockedUntil: null }) } as unknown as UsersService;

function fundRow(over: Record<string, unknown> = {}) {
  return {
    id: 'f-1',
    slug: 'andreessen-horowitz-fund-x-b-l-p',
    name: 'Andreessen Horowitz Fund X-B, L.P.',
    strategy: 'Venture capital',
    status: null,
    vintageYear: 2023,
    targetUsd: null,
    closedUsd: 425_000_000n,
    grossAssetsUsd: 3_030_000_000n,
    currency: 'USD',
    hq: 'CA, United States',
    manager: { slug: 'andreessen-horowitz', name: 'Andreessen Horowitz', domain: 'a16z.com' },
    ...over,
  };
}

describe('FundsService', () => {
  let service: FundsService;
  let findMany: jest.Mock;
  let findFirst: jest.Mock;
  let count: jest.Mock;
  let citations: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn(async () => [] as unknown[]);
    findFirst = jest.fn(async () => null);
    count = jest.fn(async () => 0);
    citations = jest.fn(async () => [] as unknown[]);
    const prisma = {
      fund: { findMany, findFirst, count },
      citation: { findMany: citations },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    service = new FundsService(prisma, unlockedUsers);
  });

  it('maps a row and its manager into a summary, money as numbers', async () => {
    count.mockResolvedValue(1);
    findMany.mockResolvedValue([fundRow()]);

    const page = await service.findAll();

    expect(page.total).toBe(1);
    expect(page.items[0]).toEqual({
      id: 'f-1',
      slug: 'andreessen-horowitz-fund-x-b-l-p',
      name: 'Andreessen Horowitz Fund X-B, L.P.',
      strategy: 'Venture capital',
      status: null,
      vintageYear: 2023,
      targetUsd: null,
      closedUsd: 425_000_000,
      grossAssetsUsd: 3_030_000_000,
      currency: 'USD',
      hq: 'CA, United States',
      manager: { slug: 'andreessen-horowitz', name: 'Andreessen Horowitz', domain: 'a16z.com' },
    });
  });

  it('excludes PENDING funds from every read', async () => {
    await service.findAll();
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { moderationStatus: 'APPROVED' },
    });
    expect(count.mock.calls[0]![0]).toMatchObject({
      where: { moderationStatus: 'APPROVED' },
    });
  });

  it('filters by strategy, status, manager slug and a case-insensitive name search', async () => {
    await service.findAll(
      {
        q: 'growth',
        strategy: 'Private equity',
        status: 'Raising',
        manager: 'blackstone',
      },
      { id: 'u1', role: 'USER' },
    );
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        moderationStatus: 'APPROVED',
        name: { contains: 'growth', mode: 'insensitive' },
        strategy: 'Private equity',
        status: 'Raising',
        manager: { slug: 'blackstone' },
      },
    });
  });

  describe('findOne', () => {
    const detailRow = (over: Record<string, unknown> = {}) => ({
      ...fundRow({ closedUsd: null, grossAssetsUsd: 1_000n }),
      launchDate: null,
      latestCloseDate: null,
      finalCloseDate: new Date('2021-03-31T00:00:00Z'),
      hardCapUsd: 600_000_000n,
      managementFeePct: 2,
      carriedInterestPct: 20,
      hurdleRatePct: 8,
      targetIrrNetMinPct: null,
      targetIrrNetMaxPct: null,
      targetIrrGrossMinPct: null,
      targetIrrGrossMaxPct: null,
      regionFocus: 'North America',
      commitments: [
        {
          id: 'c-1',
          amountUsd: 50_000_000n,
          amountLocal: null,
          currency: 'USD',
          investor: { slug: 'calpers', name: 'CalPERS', type: 'Pension fund' },
        },
      ],
      metrics: [
        { asAt: new Date('2024-06-30T00:00:00Z'), aumUsd: 9n, dryPowderUsd: null, unrealizedUsd: null },
      ],
      _count: { commitments: 7 },
      ...over,
    });

    it('404s an unknown or unpublished fund', async () => {
      await expect(service.findOne('nope')).rejects.toThrow('not found');
      expect(findFirst.mock.calls[0]![0]).toMatchObject({
        where: { slug: 'nope', moderationStatus: 'APPROVED' },
      });
    });

    it('returns terms, commitments, metrics and the total commitment count', async () => {
      findFirst.mockResolvedValue(detailRow());
      const res = await service.findOne('andreessen-horowitz-fund-x-b-l-p');

      expect(res.fund).toMatchObject({
        slug: 'andreessen-horowitz-fund-x-b-l-p',
        finalCloseDate: '2021-03-31',
        hardCapUsd: 600_000_000,
        managementFeePct: 2,
        carriedInterestPct: 20,
        regionFocus: 'North America',
      });
      expect(res.commitments).toEqual([
        {
          id: 'c-1',
          investor: { slug: 'calpers', name: 'CalPERS', type: 'Pension fund' },
          amountUsd: 50_000_000,
          amountLocal: null,
          currency: 'USD',
        },
      ]);
      expect(res.commitmentCount).toBe(7);
      expect(res.metrics).toEqual([
        { asAt: '2024-06-30', aumUsd: 9, dryPowderUsd: null, unrealizedUsd: null },
      ]);
      expect(res.indexable).toBe(true);
    });

    it('lists only commitments from live, public LPs', async () => {
      findFirst.mockResolvedValue(detailRow());
      await service.findOne('x');
      expect(findFirst.mock.calls[0]![0].include.commitments.where).toEqual({
        moderationStatus: 'APPROVED',
        investor: { moderationStatus: 'APPROVED', mergedIntoId: null },
      });
    });

    it('is noindex for a name-and-NAV fund', async () => {
      findFirst.mockResolvedValue(
        detailRow({
          finalCloseDate: null,
          managementFeePct: null,
          commitments: [],
          _count: { commitments: 0 },
        }),
      );
      await expect(service.findOne('x')).resolves.toMatchObject({ indexable: false });
    });
  });

  describe('the read gate', () => {
    const user = { id: 'u1', role: 'USER' as const };
    const partnerFund = () =>
      fundRow({ status: 'Closed', closedUsd: 271_828n, partnerFields: ['status', 'closedUsd'] });

    it('keeps partner funds, partner values and partner-column matches from a signed-out list', async () => {
      findMany.mockResolvedValue([partnerFund()]);
      const page = await service.findAll({ strategy: 'Venture capital', status: 'Closed' });

      const where = findMany.mock.calls[0]![0].where;
      expect(where).toMatchObject({
        partnerOnly: false,
        strategy: 'Venture capital',
        AND: [{ NOT: { partnerFields: { has: 'strategy' } } }],
      });
      // Status is a partner-only column: its filter is ignored, not applied.
      expect(where).not.toHaveProperty('status');
      expect(page.items[0]).toMatchObject({ status: null, closedUsd: null });
      expect(page.items[0]!.masked?.sort()).toEqual(['closedUsd', 'status']);
    });

    it('shows a signed-in viewer partner funds and values', async () => {
      findMany.mockResolvedValue([partnerFund()]);
      const page = await service.findAll({}, user);
      expect(findMany.mock.calls[0]![0].where).not.toHaveProperty('partnerOnly');
      expect(page.items[0]).toMatchObject({ status: 'Closed', closedUsd: 271_828 });
    });

    describe('findOne', () => {
      const withAccess = (access: { unlocked: boolean; signedIn: boolean }) => {
        const prisma = {
          fund: { findFirst },
          citation: { findMany: citations },
        } as unknown as PrismaService;
        return new FundsService(prisma, {
          accessFor: async () => ({ ...access, unlockedUntil: null }),
        } as unknown as UsersService);
      };
      const termsRow = (over: Record<string, unknown> = {}) => ({
        ...fundRow({ partnerFields: ['managementFeePct', 'status'], status: 'Closed' }),
        launchDate: null,
        latestCloseDate: null,
        finalCloseDate: null,
        hardCapUsd: null,
        managementFeePct: 2.71828,
        carriedInterestPct: null,
        hurdleRatePct: null,
        targetIrrNetMinPct: null,
        targetIrrNetMaxPct: null,
        targetIrrGrossMinPct: null,
        targetIrrGrossMaxPct: null,
        regionFocus: 'Europe',
        commitments: [],
        metrics: [
          { asAt: new Date('2022-06-30T00:00:00Z'), aumUsd: 1n, dryPowderUsd: null, unrealizedUsd: null, externalSource: 'PARTNER' },
          { asAt: new Date('2023-06-30T00:00:00Z'), aumUsd: 2n, dryPowderUsd: null, unrealizedUsd: null, externalSource: 'PARTNER' },
          { asAt: new Date('2024-06-30T00:00:00Z'), aumUsd: 3n, dryPowderUsd: null, unrealizedUsd: null, externalSource: 'PARTNER' },
        ],
        _count: { commitments: 4 },
        partnerOnly: false,
        ...over,
      });

      it('withholds terms, metrics, commitments and partner values from a signed-out viewer', async () => {
        findFirst.mockResolvedValue(termsRow());
        const res = await withAccess({ unlocked: false, signedIn: false }).findOne('x');

        expect(res.fund.managementFeePct).toBeNull();
        expect(res.termsHidden).toBe(true);
        expect(res.fund.status).toBeNull();
        expect(res.metrics).toEqual([]);
        expect(res.metricCount).toBe(3);
        expect(res.commitmentCount).toBe(4);
        expect(findFirst.mock.calls[0]![0].include.commitments.take).toBe(0);
        // Indexing reads the stored fund, not what this viewer sees.
        expect(res.indexable).toBe(true);
        expect(JSON.stringify(res)).not.toContain('2.71828');
      });

      it('previews metrics to a signed-in viewer, but the terms stay a contributor’s', async () => {
        findFirst.mockResolvedValue(termsRow());
        const res = await withAccess({ unlocked: false, signedIn: true }).findOne('x');

        expect(res.metrics.map((m) => m.aumUsd)).toEqual([1, 2]);
        expect(res.fund.status).toBe('Closed');
        expect(res.fund.managementFeePct).toBeNull();
        expect(res.termsHidden).toBe(true);
        expect(res.fund.regionFocus).toBe('Europe');
      });

      it('shows a contributor everything', async () => {
        findFirst.mockResolvedValue(termsRow());
        const res = await withAccess({ unlocked: true, signedIn: true }).findOne('x');
        expect(res.fund.managementFeePct).toBe(2.71828);
        expect(res.termsHidden).toBe(false);
        expect(res.metrics).toHaveLength(3);
      });

      it('never claims hidden terms for a fund that has none', async () => {
        findFirst.mockResolvedValue(termsRow({ managementFeePct: null }));
        const res = await withAccess({ unlocked: false, signedIn: true }).findOne('x');
        expect(res.termsHidden).toBe(false);
      });

      it('returns a stub of a partner-only fund to a signed-out viewer', async () => {
        findFirst.mockResolvedValue(termsRow({ partnerOnly: true }));
        const res = await withAccess({ unlocked: false, signedIn: false }).findOne('x');
        expect(res.fund).toMatchObject({ name: fundRow().name, partnerOnly: true, strategy: null, regionFocus: null });
        expect(res.fund.manager.domain).toBeNull();
        expect(res.indexable).toBe(false);
        expect(res.citations).toEqual([]);
      });
    });
  });

  it('paginates with the shared default page size', async () => {
    count.mockResolvedValue(95_000);
    await service.findAll({ page: 3 });

    expect(findMany.mock.calls[0]![0]).toMatchObject({ skip: 50, take: 25 });
    await expect(service.findAll({ page: 3 })).resolves.toMatchObject({
      page: 3,
      pageSize: 25,
      total: 95_000,
    });
  });

  describe('fundOrderBy', () => {
    it('defaults to size, so the SPV platforms do not own every page', () => {
      expect(fundOrderBy(undefined)).toEqual([
        { sizeUsd: { sort: 'desc', nulls: 'last' } },
        { name: 'asc' },
      ]);
    });

    it('sorts by vintage, newest first, with unreported vintages last', () => {
      expect(fundOrderBy('vintage')).toEqual([
        { vintageYear: { sort: 'desc', nulls: 'last' } },
        { name: 'asc' },
      ]);
    });

    it('sorts by name', () => {
      expect(fundOrderBy('name')).toEqual([{ name: 'asc' }]);
    });
  });
});
