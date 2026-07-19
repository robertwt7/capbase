import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import { InvestorsService } from './investors.service';
import { PrismaService } from '../prisma/prisma.service';

function holding(
  name: string,
  type: string,
  company: { slug: string; name: string; domain: string; primarySector: string | null },
) {
  return { name, type, company };
}

describe('InvestorsService.findAll', () => {
  let service: InvestorsService;
  let findMany: jest.Mock;
  let groupBy: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn();
    groupBy = jest.fn();
    const prisma = { investorHolding: { findMany, groupBy } } as unknown as PrismaService;
    service = new InvestorsService(prisma);
  });

  it('dedupes an investor across multiple companies and counts the portfolio', async () => {
    groupBy.mockResolvedValue([{ name: 'Sequoia Capital' }]);
    findMany.mockResolvedValue([
      holding('Sequoia Capital', 'Venture', {
        slug: 'helia',
        name: 'Helia',
        domain: 'helia.com',
        primarySector: 'Fintech',
      }),
      holding('Sequoia Capital', 'Venture', {
        slug: 'sable-labs',
        name: 'Sable Labs',
        domain: 'sable.com',
        primarySector: 'Artificial intelligence',
      }),
    ]);

    const { items, total } = await service.findAll();
    const [investor] = items;

    expect(total).toBe(1);
    expect(investor.name).toBe('Sequoia Capital');
    expect(investor.portfolioCount).toBe(2);
    expect(investor.companies).toHaveLength(2);
    expect(investor.sectors).toEqual(['Artificial intelligence', 'Fintech']);
  });

  it('picks the most-frequent type across holdings', async () => {
    groupBy.mockResolvedValue([{ name: 'Tiger Global' }]);
    findMany.mockResolvedValue([
      holding('Tiger Global', 'Venture', {
        slug: 'a',
        name: 'A',
        domain: 'a.com',
        primarySector: null,
      }),
      holding('Tiger Global', 'Growth', {
        slug: 'b',
        name: 'B',
        domain: 'b.com',
        primarySector: null,
      }),
      holding('Tiger Global', 'Growth', {
        slug: 'c',
        name: 'C',
        domain: 'c.com',
        primarySector: null,
      }),
    ]);

    const { items } = await service.findAll();

    expect(items[0].type).toBe('Growth');
  });

  it('preserves the SQL page order and requests portfolio-count ordering', async () => {
    groupBy.mockResolvedValue([{ name: 'Big Fund' }, { name: 'Small Fund' }]);
    findMany.mockResolvedValue([
      holding('Small Fund', 'Angel', {
        slug: 'a',
        name: 'A',
        domain: 'a.com',
        primarySector: null,
      }),
      holding('Big Fund', 'Venture', {
        slug: 'a',
        name: 'A',
        domain: 'a.com',
        primarySector: null,
      }),
      holding('Big Fund', 'Venture', {
        slug: 'b',
        name: 'B',
        domain: 'b.com',
        primarySector: null,
      }),
    ]);

    const { items } = await service.findAll();

    expect(items.map((i) => i.name)).toEqual(['Big Fund', 'Small Fund']);
    // The page query (second groupBy call) must sort by holding count, name asc.
    expect(groupBy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderBy: [{ _count: { name: 'desc' } }, { name: 'asc' }],
      }),
    );
  });

  it('only reads approved holdings on approved companies', async () => {
    groupBy.mockResolvedValue([]);
    findMany.mockResolvedValue([]);

    const { items, total } = await service.findAll();

    expect(items).toEqual([]);
    expect(total).toBe(0);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          moderationStatus: 'APPROVED',
          company: { moderationStatus: 'APPROVED' },
        },
      }),
    );
    // No page of names — the holdings query must be skipped entirely.
    expect(findMany).not.toHaveBeenCalled();
  });
});
