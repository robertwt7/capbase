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
  return {
    name: `Person ${i}`,
    role: 'CEO',
    since: 2016,
    prior: null,
    linkedinUrl: `https://www.linkedin.com/in/person-${i}`,
    title: 'Chief Executive Officer',
  };
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
    websiteUrl: 'https://helia.com',
    linkedinUrl: 'https://www.linkedin.com/company/helia',
    twitterUrl: null,
    legalName: 'Helia Payments, Inc.',
    operatingStatus: 'Active',
    companyType: 'For profit',
    primarySector: 'Fintech',
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

  it('maps the new link/metadata fields through to the read shape', async () => {
    const { company } = await service.getCompanyDetail('helia', {
      id: 'admin1',
      role: 'ADMIN',
    });

    expect(company.websiteUrl).toBe('https://helia.com');
    expect(company.linkedinUrl).toBe('https://www.linkedin.com/company/helia');
    expect(company.legalName).toBe('Helia Payments, Inc.');
    expect(company.operatingStatus).toBe('Active');
    expect(company.companyType).toBe('For profit');
    expect(company.primarySector).toBe('Fintech');
    expect(company.people?.[0]?.linkedinUrl).toBe('https://www.linkedin.com/in/person-1');
    expect(company.people?.[0]?.title).toBe('Chief Executive Officer');
  });
});

describe('CompaniesService.createCompany (new fields persist)', () => {
  it('passes the new link/metadata fields to prisma.company.create', async () => {
    const create = jest.fn(async () => ({
      id: 'c1',
      slug: 'acme',
      moderationStatus: 'PENDING',
    }));
    const findUnique = jest.fn(async () => null);
    const prisma = {
      company: { create, findUnique },
    } as unknown as PrismaService;
    const users = {} as unknown as UsersService;
    const service = new CompaniesService(prisma, users);

    await service.createCompany(
      {
        name: 'Acme',
        domain: 'acme.com',
        oneLiner: 'one',
        description: 'desc',
        hq: 'SF',
        founded: 2020,
        headcount: 5,
        industry: ['Fintech'],
        status: 'Private',
        stage: 'Seed',
        totalRaisedUsd: 100,
        websiteUrl: 'https://acme.com',
        linkedinUrl: 'https://www.linkedin.com/company/acme',
        primarySector: 'Fintech',
        operatingStatus: 'Active',
        companyType: 'For profit',
      } as never,
      'u1',
    );

    const data = (create.mock.calls[0] as unknown[])[0] as {
      data: Record<string, unknown>;
    };
    expect(data.data.websiteUrl).toBe('https://acme.com');
    expect(data.data.linkedinUrl).toBe('https://www.linkedin.com/company/acme');
    expect(data.data.primarySector).toBe('Fintech');
    expect(data.data.operatingStatus).toBe('Active');
    expect(data.data.companyType).toBe('For profit');
  });
});
