import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

import { CompaniesService } from './companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

const DAY = 86_400_000;

function makeRound(i: number) {
  return {
    id: `r${i}`,
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
    id: `p${i}`,
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
    id: 'c1',
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

function makeCitation(entityId: string, field = '') {
  return {
    id: `cit-${entityId}-${field}`,
    entityType: entityId.startsWith('r') ? 'round' : 'company',
    entityId,
    field,
    note: null,
    source: {
      url: `https://www.sec.gov/${entityId}`,
      sourceType: 'SEC filing',
      title: null,
      publisher: 'SEC',
      reference: null,
      retrievedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  };
}

describe('CompaniesService.getCompanyDetail (contribution gating)', () => {
  let service: CompaniesService;
  let lastContributionAt: jest.Mock<(userId: string) => Promise<Date | null>>;
  let findFirst: jest.Mock;
  let citationFindMany: jest.Mock<
    (args: { where: { entityId: { in: string[] } } }) => Promise<unknown[]>
  >;

  beforeEach(() => {
    findFirst = jest.fn(async () => dbCompany());
    lastContributionAt = jest.fn(async () => null);
    // Only cited rows come back — the real query filters by the id list.
    citationFindMany = jest.fn(async (args) =>
      ['c1', 'r1', 'r2', 'r3', 'r4']
        .filter((id) => args.where.entityId.in.includes(id))
        .map((id) => makeCitation(id)),
    );
    const prisma = {
      company: { findFirst },
      citation: { findMany: citationFindMany },
    } as unknown as PrismaService;
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

  it('never returns citations for preview-truncated rows', async () => {
    const { company, citations } = await service.getCompanyDetail('helia');

    // Locked: rounds 3 and 4 were sliced off, so their citations must not leak.
    expect(company.rounds).toHaveLength(2);
    expect(citationFindMany.mock.calls[0]![0].where.entityId.in).toEqual([
      'c1',
      'r1',
      'r2',
      'p1',
      'p2',
    ]);
    expect(citations.map((c) => c.entityId)).toEqual(['c1', 'r1', 'r2']);
  });

  it('returns citations for every row an unlocked viewer can see', async () => {
    lastContributionAt.mockResolvedValue(new Date());

    const { citations } = await service.getCompanyDetail('helia', {
      id: 'u1',
      role: 'USER',
    });

    expect(citations.map((c) => c.entityId)).toEqual(['c1', 'r1', 'r2', 'r3', 'r4']);
    expect(citations[0]!.source).toMatchObject({
      url: 'https://www.sec.gov/c1',
      publisher: 'SEC',
      retrievedAt: '2026-08-01T00:00:00.000Z',
    });
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

describe('CompaniesService.listSlugs (sitemap feed)', () => {
  it('returns approved slugs only, with ISO-formatted update timestamps', async () => {
    const findMany = jest.fn(async () => [
      { slug: 'helia', updatedAt: new Date('2026-07-01T10:30:00.000Z') },
      { slug: 'vellum', updatedAt: new Date('2026-06-15T08:00:00.000Z') },
    ]);
    const prisma = { company: { findMany } } as unknown as PrismaService;
    const users = {} as unknown as UsersService;
    const service = new CompaniesService(prisma, users);

    const entries = await service.listSlugs();

    expect(findMany).toHaveBeenCalledWith({
      where: { moderationStatus: 'APPROVED' },
      select: { slug: true, updatedAt: true },
      orderBy: { slug: 'asc' },
    });
    expect(entries).toEqual([
      { slug: 'helia', updatedAt: '2026-07-01T10:30:00.000Z' },
      { slug: 'vellum', updatedAt: '2026-06-15T08:00:00.000Z' },
    ]);
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

describe('CompaniesService.getCompanyHistory', () => {
  function revision(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rev1',
      companyId: 'c1',
      entityType: 'company',
      entityId: 'c1',
      field: 'hq',
      before: 'SF',
      after: 'Berlin',
      action: 'UPDATE',
      actor: 'ADMIN',
      actorSource: null,
      actorUser: { name: 'Ada Admin' },
      createdAt: new Date('2026-08-20T09:00:00.000Z'),
      ...overrides,
    };
  }

  function makeService(rows: ReturnType<typeof revision>[], company: unknown = { id: 'c1' }) {
    const findFirst = jest.fn(async () => company);
    const count = jest.fn(async () => rows.length);
    const findMany = jest.fn(async () => rows);
    const prisma = {
      company: {
        findFirst,
        findMany: jest.fn(async () => [{ id: 'c1', name: 'Helia' }]),
      },
      fundingRound: {
        findMany: jest.fn(async () => [{ id: 'r1', name: 'Series B' }]),
      },
      person: { findMany: jest.fn(async () => []) },
      investorHolding: { findMany: jest.fn(async () => []) },
      acquisitionDeal: { findMany: jest.fn(async () => []) },
      exitEvent: { findMany: jest.fn(async () => []) },
      diversitySignal: { findMany: jest.fn(async () => []) },
      revision: { count, findMany },
      // The array form: the mocked members already return promises.
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    return {
      service: new CompaniesService(prisma, {} as unknown as UsersService),
      findFirst,
      findMany,
    };
  }

  it('404s for a company that is not approved', async () => {
    const { service, findFirst } = makeService([], null);

    await expect(service.getCompanyHistory('helia')).rejects.toThrow(NotFoundException);
    // The APPROVED filter is part of the query, not a post-check.
    expect(findFirst.mock.calls[0]![0]).toMatchObject({
      where: { slug: 'helia', moderationStatus: 'APPROVED' },
    });
  });

  it('returns a paginated, newest-first page with resolved entity labels', async () => {
    const { service, findMany } = makeService([
      revision(),
      revision({
        id: 'rev2',
        entityType: 'round',
        entityId: 'r1',
        field: '',
        action: 'CREATE',
      }),
    ]);

    const result = await service.getCompanyHistory('helia', 2, 10);

    expect(result).toMatchObject({ total: 2, page: 2, pageSize: 10 });
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(result.items[0]).toMatchObject({
      entityLabel: 'Helia',
      field: 'hq',
      before: 'SF',
      after: 'Berlin',
      actorName: 'Ada Admin',
      createdAt: '2026-08-20T09:00:00.000Z',
    });
    expect(result.items[1]!.entityLabel).toBe('Series B round');
  });

  it('attributes an ingest revision to its source, never a user', async () => {
    const { service } = makeService([
      revision({ actor: 'INGEST', actorSource: 'WIKIDATA', actorUser: null }),
    ]);

    const { items } = await service.getCompanyHistory('helia');

    expect(items[0]!.actorName).toBe('WIKIDATA');
  });

  it('never exposes a contributor email', async () => {
    // The row select asks for `name` only; even a leaked email field on the
    // joined user must not reach the public payload.
    const { service } = makeService([
      revision({ actorUser: { name: 'Ada Admin', email: 'ada@example.com' } }),
    ]);

    const { items } = await service.getCompanyHistory('helia');

    expect(JSON.stringify(items)).not.toContain('@example.com');
    expect(items[0]!.actorName).toBe('Ada Admin');
  });
});
