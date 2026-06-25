import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import { CompaniesService } from './companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

const DAY = 86_400_000;

function makeRound(i: number) {
  return {
    name: `Round ${i}`,
    date: new Date('2020-01-01'),
    amountUsd: 100n,
    postMoneyUsd: null,
    lead: null,
    investors: [],
  };
}

function makePerson(i: number) {
  return { name: `Person ${i}`, role: 'CEO', since: 2016, prior: null };
}

function dbCompany() {
  return {
    slug: 'helia',
    name: 'Helia',
    domain: 'helia.com',
    oneLiner: 'one liner',
    description: 'desc',
    hq: 'SF',
    founded: 2016,
    headcount: 10,
    industry: ['Fintech'],
    status: 'Private',
    stage: 'Series B',
    totalRaisedUsd: 1000n,
    lastValuationUsd: null,
    revenueUsd: null,
    revenueGrowthPct: null,
    grossMarginPct: null,
    burnMonths: null,
    rounds: [makeRound(1), makeRound(2), makeRound(3), makeRound(4)],
    people: [makePerson(1), makePerson(2), makePerson(3)],
    investors: [],
    acquisitions: [],
    exits: [],
    diversity: [],
  };
}

describe('CompaniesService.getCompanyDetail (contribution gating)', () => {
  let service: CompaniesService;
  let lastContributionAt: jest.Mock<(userId: string) => Promise<Date | null>>;
  let findFirst: jest.Mock;

  beforeEach(() => {
    findFirst = jest.fn(async () => dbCompany());
    lastContributionAt = jest.fn(async () => null);
    const prisma = { company: { findFirst } } as unknown as PrismaService;
    const users = { lastContributionAt } as unknown as UsersService;
    service = new CompaniesService(prisma, users);
  });

  it('truncates each section to the preview limit for an anonymous viewer', async () => {
    const { company, access } = await service.getCompanyDetail('helia');

    expect(access.unlocked).toBe(false);
    expect(company.rounds).toHaveLength(2);
    expect(company.people).toHaveLength(2);
    expect(access.totals.rounds).toBe(4);
    expect(access.totals.people).toBe(3);
    expect(access.unlockedUntil).toBeNull();
    expect(lastContributionAt).not.toHaveBeenCalled();
  });

  it('returns full sections when the viewer contributed inside the window', async () => {
    lastContributionAt.mockResolvedValue(new Date());

    const { company, access } = await service.getCompanyDetail('helia', {
      id: 'u1',
      role: 'USER',
    });

    expect(access.unlocked).toBe(true);
    expect(company.rounds).toHaveLength(4);
    expect(company.people).toHaveLength(3);
    expect(access.unlockedUntil).not.toBeNull();
  });

  it('re-locks when the only contribution is older than the window', async () => {
    lastContributionAt.mockResolvedValue(new Date(Date.now() - 31 * DAY));

    const { company, access } = await service.getCompanyDetail('helia', {
      id: 'u1',
      role: 'USER',
    });

    expect(access.unlocked).toBe(false);
    expect(company.rounds).toHaveLength(2);
    // The expiry date is still reported so the UI can say "expired on …".
    expect(access.unlockedUntil).not.toBeNull();
  });

  it('always unlocks for an admin without checking contributions', async () => {
    const { company, access } = await service.getCompanyDetail('helia', {
      id: 'admin1',
      role: 'ADMIN',
    });

    expect(access.unlocked).toBe(true);
    expect(company.rounds).toHaveLength(4);
    expect(lastContributionAt).not.toHaveBeenCalled();
  });
});
