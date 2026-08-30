import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import { FundsService, fundOrderBy } from './funds.service';
import { PrismaService } from '../prisma/prisma.service';

function fundRow(over: Record<string, unknown> = {}) {
  return {
    id: 'f-1',
    name: 'Andreessen Horowitz Fund X-B, L.P.',
    strategy: 'Venture capital',
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
  let count: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn(async () => [] as unknown[]);
    count = jest.fn(async () => 0);
    const prisma = {
      fund: { findMany, count },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    service = new FundsService(prisma);
  });

  it('maps a row and its manager into a summary, money as numbers', async () => {
    count.mockResolvedValue(1);
    findMany.mockResolvedValue([fundRow()]);

    const page = await service.findAll();

    expect(page.total).toBe(1);
    expect(page.items[0]).toEqual({
      id: 'f-1',
      name: 'Andreessen Horowitz Fund X-B, L.P.',
      strategy: 'Venture capital',
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

  it('filters by strategy, manager slug and a case-insensitive name search', async () => {
    await service.findAll({ q: 'growth', strategy: 'Private equity', manager: 'blackstone' });
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        moderationStatus: 'APPROVED',
        name: { contains: 'growth', mode: 'insensitive' },
        strategy: 'Private equity',
        manager: { slug: 'blackstone' },
      },
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
        { grossAssetsUsd: { sort: 'desc', nulls: 'last' } },
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
