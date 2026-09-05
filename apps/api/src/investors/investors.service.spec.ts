import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

import { InvestorsService } from './investors.service';
import { PrismaService } from '../prisma/prisma.service';

function company(slug: string, name: string, primarySector: string | null) {
  return { slug, name, domain: `${slug}.com`, primarySector };
}

function investorRow(over: Record<string, unknown> = {}) {
  return {
    id: 'i-1',
    slug: 'sequoia-capital',
    name: 'Sequoia Capital',
    legalName: null,
    type: 'Venture',
    hq: 'Menlo Park, CA',
    websiteUrl: 'https://www.sequoiacap.com',
    linkedinUrl: null,
    domain: 'sequoiacap.com',
    description: null,
    crdNumber: null,
    cikNumber: null,
    fundCount: null,
    assetsUsd: null,
    foundedYear: 1972,
    holdings: [],
    funds: [],
    _count: { holdings: 0, funds: 0 },
    ...over,
  };
}

function fundRow(over: Record<string, unknown> = {}) {
  return {
    id: 'f-1',
    name: 'Sequoia Growth Fund III, L.P.',
    strategy: 'Venture capital',
    vintageYear: 2022,
    targetUsd: null,
    closedUsd: null,
    grossAssetsUsd: 3_030_000_000n,
    currency: 'USD',
    hq: 'CA, United States',
    ...over,
  };
}

describe('InvestorsService', () => {
  let service: InvestorsService;
  let findMany: jest.Mock;
  let count: jest.Mock;
  let findFirst: jest.Mock;
  let transaction: jest.Mock;
  let citationFindMany: jest.Mock;
  let identifierFindMany: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn();
    count = jest.fn();
    findFirst = jest.fn();
    citationFindMany = jest.fn(async () => []);
    identifierFindMany = jest.fn(async () => []);
    // $transaction resolves the array of queries it is handed.
    transaction = jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));
    const prisma = {
      // findUnique backs the miss path: is this slug a tombstone, or nothing?
      investor: { findMany, count, findFirst, findUnique: jest.fn(async () => null) },
      citation: { findMany: citationFindMany },
      entityIdentifier: { findMany: identifierFindMany },
      $transaction: transaction,
    } as unknown as PrismaService;
    service = new InvestorsService(prisma);
  });

  describe('findAll', () => {
    it('maps a row and its portfolio into a summary', async () => {
      count.mockResolvedValue(1);
      findMany.mockResolvedValue([
        investorRow({
          holdings: [
            { company: company('sable-labs', 'Sable Labs', 'Artificial intelligence') },
            { company: company('helia', 'Helia', 'Fintech') },
          ],
          _count: { holdings: 2 },
        }),
      ]);

      const { items, total } = await service.findAll();
      const [investor] = items;

      expect(total).toBe(1);
      expect(investor!.slug).toBe('sequoia-capital');
      expect(investor!.name).toBe('Sequoia Capital');
      expect(investor!.portfolioCount).toBe(2);
      // Companies are sorted by name, sectors deduped and sorted.
      expect(investor!.companies.map((c) => c.name)).toEqual(['Helia', 'Sable Labs']);
      expect(investor!.sectors).toEqual(['Artificial intelligence', 'Fintech']);
    });

    it('takes portfolioCount from the filtered relation count, not the sample', async () => {
      count.mockResolvedValue(1);
      findMany.mockResolvedValue([
        investorRow({
          // The list read only loads a sample of holdings…
          holdings: [{ company: company('helia', 'Helia', 'Fintech') }],
          // …so the real total must come from _count.
          _count: { holdings: 28 },
        }),
      ]);

      const { items } = await service.findAll();
      expect(items[0]!.portfolioCount).toBe(28);
      expect(items[0]!.companies).toHaveLength(1);
    });

    it('includes investors with no portfolio at all', async () => {
      // The SEC Form ADV universe is mostly firms with no disclosed portfolio;
      // hiding them would drop ~85% of the directory.
      count.mockResolvedValue(1);
      findMany.mockResolvedValue([
        investorRow({ slug: 'next-coast-ventures', name: 'Next Coast Ventures' }),
      ]);

      const { items } = await service.findAll();
      expect(items[0]!.portfolioCount).toBe(0);
      expect(items[0]!.companies).toEqual([]);
      expect(items[0]!.sectors).toEqual([]);
      // No `holdings: { some: … }` filter may creep into the where clause.
      expect(findMany.mock.calls[0]![0]).toMatchObject({
        where: { moderationStatus: 'APPROVED', mergedIntoId: null },
      });
    });

    it('orders by portfolio size by default and by name when asked', async () => {
      count.mockResolvedValue(0);
      findMany.mockResolvedValue([]);

      await service.findAll();
      expect(findMany.mock.calls[0]![0]).toMatchObject({
        orderBy: [{ holdings: { _count: 'desc' } }, { name: 'asc' }],
      });

      await service.findAll({ sort: 'name' });
      expect(findMany.mock.calls[1]![0]).toMatchObject({ orderBy: [{ name: 'asc' }] });
    });

    it('filters by search term and type, and paginates', async () => {
      count.mockResolvedValue(0);
      findMany.mockResolvedValue([]);

      const result = await service.findAll({ q: 'sequoia', type: 'Venture', page: 3, pageSize: 10 });

      expect(findMany.mock.calls[0]![0]).toMatchObject({
        where: {
          moderationStatus: 'APPROVED',
          name: { contains: 'sequoia', mode: 'insensitive' },
          type: 'Venture',
        },
        skip: 20,
        take: 10,
      });
      expect(result).toMatchObject({ page: 3, pageSize: 10, total: 0 });
    });

    it('counts only approved holdings on approved companies', async () => {
      count.mockResolvedValue(0);
      findMany.mockResolvedValue([]);
      await service.findAll();

      const args = findMany.mock.calls[0]![0] as {
        include: { _count: { select: { holdings: { where: unknown } } } };
      };
      expect(args.include._count.select.holdings.where).toEqual({
        moderationStatus: 'APPROVED',
        company: { moderationStatus: 'APPROVED', mergedIntoId: null },
      });
    });
  });

  describe('findOne', () => {
    it('returns the full portfolio for an approved investor', async () => {
      findFirst.mockResolvedValue(
        investorRow({
          holdings: [{ company: company('helia', 'Helia', 'Fintech') }],
          _count: { holdings: 1, funds: 0 },
          fundCount: 119,
          assetsUsd: 106_486_870_258n,
        }),
      );

      const investor = await service.findOne('sequoia-capital');

      expect(investor.slug).toBe('sequoia-capital');
      expect(investor.portfolioCount).toBe(1);
      expect(investor.fundCount).toBe(119);
      // BigInt money columns cross the wire as numbers.
      expect(investor.assetsUsd).toBe(106_486_870_258);
      expect(findFirst.mock.calls[0]![0]).toMatchObject({
        where: { slug: 'sequoia-capital', moderationStatus: 'APPROVED', mergedIntoId: null },
      });
    });

    it('returns the named funds and both counts, which are different facts', async () => {
      findFirst.mockResolvedValue(
        investorRow({
          fundCount: 119,
          funds: [fundRow()],
          _count: { holdings: 0, funds: 92 },
        }),
      );

      const investor = await service.findOne('sequoia-capital');

      // What the firm told the SEC vs what the public archive lets us name.
      expect(investor.fundCount).toBe(119);
      expect(investor.namedFundCount).toBe(92);
      expect(investor.funds).toHaveLength(1);
      expect(investor.funds[0]).toMatchObject({
        id: 'f-1',
        strategy: 'Venture capital',
        vintageYear: 2022,
        grossAssetsUsd: 3_030_000_000,
        targetUsd: null,
      });
      // Preview only — the SPV platforms report tens of thousands.
      expect(findFirst.mock.calls[0]![0]).toMatchObject({
        include: { funds: { where: { moderationStatus: 'APPROVED' }, take: 12 } },
      });
    });

    it('loads citations only for the fund rows it is returning', async () => {
      findFirst.mockResolvedValue(
        investorRow({ funds: [fundRow()], _count: { holdings: 0, funds: 1 } }),
      );
      await service.findOne('sequoia-capital');

      expect(citationFindMany.mock.calls[0]![0]).toMatchObject({
        where: { entityType: 'fund', entityId: { in: ['f-1'] } },
      });
    });

    it('does not query citations when the firm has no named funds', async () => {
      findFirst.mockResolvedValue(investorRow());
      const investor = await service.findOne('sequoia-capital');

      expect(investor.funds).toEqual([]);
      expect(investor.citations).toEqual([]);
      expect(citationFindMany).not.toHaveBeenCalled();
    });

    it('404s for an unknown or unapproved slug', async () => {
      findFirst.mockResolvedValue(null);
      await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listSlugs', () => {
    it('returns approved slugs with ISO timestamps for the sitemap', async () => {
      findMany.mockResolvedValue([
        { slug: 'sequoia-capital', updatedAt: new Date('2026-08-02T13:11:06.356Z') },
      ]);

      await expect(service.listSlugs()).resolves.toEqual([
        { slug: 'sequoia-capital', updatedAt: '2026-08-02T13:11:06.356Z' },
      ]);
      expect(findMany.mock.calls[0]![0]).toMatchObject({
        where: { moderationStatus: 'APPROVED', mergedIntoId: null },
      });
    });
  });
});
