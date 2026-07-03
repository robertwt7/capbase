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

  beforeEach(() => {
    findMany = jest.fn();
    const prisma = { investorHolding: { findMany } } as unknown as PrismaService;
    service = new InvestorsService(prisma);
  });

  it('dedupes an investor across multiple companies and counts the portfolio', async () => {
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

    const [investor] = await service.findAll();

    expect(investor.name).toBe('Sequoia Capital');
    expect(investor.portfolioCount).toBe(2);
    expect(investor.companies).toHaveLength(2);
    expect(investor.sectors).toEqual(['Artificial intelligence', 'Fintech']);
  });

  it('picks the most-frequent type across holdings', async () => {
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

    const [investor] = await service.findAll();

    expect(investor.type).toBe('Growth');
  });

  it('orders by portfolio count desc, then name asc', async () => {
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

    const result = await service.findAll();

    expect(result.map((i) => i.name)).toEqual(['Big Fund', 'Small Fund']);
  });

  it('only reads approved holdings on approved companies', async () => {
    findMany.mockResolvedValue([]);

    await service.findAll();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          moderationStatus: 'APPROVED',
          company: { moderationStatus: 'APPROVED' },
        },
      }),
    );
  });
});
