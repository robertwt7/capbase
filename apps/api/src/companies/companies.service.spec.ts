import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { SITEMAP_PAGE_SIZE } from '@repo/api';

import { CompaniesService } from './companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

const DAY = 86_400_000;

function makeRound(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `r${i}`,
    name: `Round ${i}`,
    date: new Date(`2020-0${i}-01`),
    amountUsd: 100n,
    postMoneyUsd: null,
    lead: null,
    externalSource: 'SEC_EDGAR',
    partnerFields: [] as string[],
    investors: [] as Record<string, unknown>[],
    ...overrides,
  };
}

function makePerson(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `p${i}`,
    name: `Person ${i}`,
    role: 'CEO',
    since: 2016,
    prior: null,
    linkedinUrl: `https://www.linkedin.com/in/person-${i}`,
    title: 'Chief Executive Officer',
    externalSource: 'SEC_EDGAR',
    ...overrides,
  };
}

function dbCompany(overrides: Record<string, unknown> = {}) {
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
    partnerFields: [] as string[],
    partnerOnly: false,
    rounds: [makeRound(1), makeRound(2), makeRound(3), makeRound(4)],
    people: [makePerson(1), makePerson(2), makePerson(3)],
    investors: [] as Record<string, unknown>[],
    acquisitions: [] as Record<string, unknown>[],
    exits: [] as Record<string, unknown>[],
    diversity: [] as Record<string, unknown>[],
    ...overrides,
  };
}

/** The slice of a Prisma `where` the company reads use, evaluated in memory. */
function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === 'OR') return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    if (key === 'NOT') return !(cond as Record<string, unknown>[]).some((w) => matches(row, w));
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as { not?: unknown; in?: unknown[]; notIn?: unknown[]; has?: unknown };
      if ('not' in c) return row[key] !== c.not && row[key] !== null && row[key] !== undefined;
      if ('in' in c) return c.in!.includes(row[key]);
      if ('notIn' in c) return !c.notIn!.includes(row[key]);
      if ('has' in c) return ((row[key] as unknown[]) ?? []).includes(c.has);
    }
    // moderationStatus is not on the fixtures: every row is approved.
    if (key === 'moderationStatus') return true;
    return (row[key] ?? null) === cond;
  });
}

/** `company.findFirst` honouring the include's per-section where + take, as
 *  the database would. */
function findFirstHonouringInclude(row: ReturnType<typeof dbCompany>) {
  return jest.fn(async (args: { include?: Record<string, { where?: Record<string, unknown>; take?: number; include?: { investors?: { where?: Record<string, unknown> } } }> }) => {
    const out: Record<string, unknown> = { ...row };
    for (const [section, spec] of Object.entries(args.include ?? {})) {
      let rows = ((row as Record<string, unknown>)[section] as Record<string, unknown>[]).filter((r) =>
        matches(r, spec.where),
      );
      if (spec.take !== undefined) rows = rows.slice(0, spec.take);
      if (section === 'rounds') {
        rows = rows.map((r) => ({
          ...r,
          investors: (r.investors as Record<string, unknown>[]).filter((i) =>
            matches(i, spec.include?.investors?.where),
          ),
        }));
      }
      out[section] = rows;
    }
    return out;
  });
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
  let row: ReturnType<typeof dbCompany>;
  let citationFindMany: jest.Mock<
    (args: { where: { entityId: { in: string[] } } }) => Promise<unknown[]>
  >;
  const user = { id: 'u1', role: 'USER' as const };

  function build(company = dbCompany()) {
    row = company;
    lastContributionAt = jest.fn(async () => null);
    // Only cited rows come back — the real query filters by the id list.
    citationFindMany = jest.fn(async (args) =>
      ['c1', 'r1', 'r2', 'r3', 'r4']
        .filter((id) => args.where.entityId.in.includes(id))
        .map((id) => makeCitation(id)),
    );
    const count = (section: keyof ReturnType<typeof dbCompany>) =>
      jest.fn(async () => (row[section] as unknown[]).length);
    const prisma = {
      company: { findFirst: findFirstHonouringInclude(row) },
      fundingRound: {
        count: count('rounds'),
        findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => {
          const hits = row.rounds.filter((r) => matches(r, { ...args.where, companyId: undefined }));
          const latest = [...hits].sort((a, b) => b.date.getTime() - a.date.getTime())[0];
          return latest ? { name: latest.name, date: latest.date } : null;
        }),
      },
      personRole: { count: count('people') },
      investorHolding: { count: count('investors') },
      acquisitionDeal: { count: count('acquisitions') },
      exitEvent: { count: count('exits') },
      diversitySignal: { count: count('diversity') },
      citation: { findMany: citationFindMany },
      entityIdentifier: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService;
    // The real `accessFor` over a mocked `lastContributionAt`, so these tests
    // pin the gate rule itself rather than a stub of it.
    const users = Object.assign(Object.create(UsersService.prototype) as UsersService, {
      lastContributionAt,
    });
    service = new CompaniesService(prisma, users);
  }

  beforeEach(() => build());

  it('gives a signed-out viewer no money sections and a preview of the open ones', async () => {
    const { company, access } = await service.getCompanyDetail('helia');

    expect(access).toMatchObject({ unlocked: false, signedIn: false, unlockedUntil: null });
    // Rounds are `members`: nothing until signed in.
    expect(company.rounds).toHaveLength(0);
    // People are `open`: the preview.
    expect(company.people).toHaveLength(2);
    // Counts are public whatever the viewer.
    expect(access.totals.rounds).toBe(4);
    expect(access.totals.people).toBe(3);
    expect(lastContributionAt).not.toHaveBeenCalled();
  });

  it('previews every section to a signed-in viewer who has not contributed', async () => {
    const { company, access } = await service.getCompanyDetail('helia', user);

    expect(access).toMatchObject({ unlocked: false, signedIn: true });
    expect(company.rounds?.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(company.people).toHaveLength(2);
  });

  it('returns full sections when the viewer contributed inside the window', async () => {
    lastContributionAt.mockResolvedValue(new Date());

    const { company, access } = await service.getCompanyDetail('helia', user);

    expect(access.unlocked).toBe(true);
    expect(company.rounds).toHaveLength(4);
    expect(company.people).toHaveLength(3);
    expect(access.unlockedUntil).not.toBeNull();
  });

  it('re-locks when the only contribution is older than the window', async () => {
    lastContributionAt.mockResolvedValue(new Date(Date.now() - 31 * DAY));

    const { company, access } = await service.getCompanyDetail('helia', user);

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

  it('never returns citations for rows outside the response', async () => {
    const { company, citations } = await service.getCompanyDetail('helia', user);

    // Locked: rounds 3 and 4 were never loaded, so their citations must not leak.
    expect(company.rounds).toHaveLength(2);
    expect(citationFindMany.mock.calls[0]![0].where.entityId.in).toEqual(['c1', 'r1', 'r2', 'p1', 'p2']);
    expect(citations.map((c) => c.entityId)).toEqual(['c1', 'r1', 'r2']);
  });

  it('returns citations for every row an unlocked viewer can see', async () => {
    lastContributionAt.mockResolvedValue(new Date());

    const { citations } = await service.getCompanyDetail('helia', user);

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

  describe('partner provenance', () => {
    const partnerCompany = () =>
      dbCompany({
        description: 'PARTNER-DESCRIPTION',
        totalRaisedUsd: 9_000_000n,
        partnerFields: ['description', 'totalRaisedUsd'],
        rounds: [
          makeRound(1, {
            externalSource: null,
            investors: [
              { name: 'Public VC', lead: true, externalSource: null },
              { name: 'PARTNER-VC', lead: false, externalSource: 'PARTNER' },
            ],
          }),
          makeRound(2, { name: 'PARTNER-ROUND', externalSource: 'PARTNER' }),
          makeRound(3, { partnerFields: ['amountUsd'], amountUsd: 7n }),
        ],
        people: [makePerson(1, { name: 'PARTNER-PERSON', externalSource: 'PARTNER' }), makePerson(2), makePerson(3)],
      });

    it('masks partner fields and drops partner rows for a signed-out viewer, counting them still', async () => {
      build(partnerCompany());
      const res = await service.getCompanyDetail('helia');
      const json = JSON.stringify(res);

      expect(res.company.description).toBe('');
      expect(res.company.totalRaisedUsd).toBe(0);
      expect(res.company.masked?.sort()).toEqual(['description', 'totalRaisedUsd']);
      expect(json).not.toContain('PARTNER-');
      expect(res.company.people?.map((p) => p.id)).toEqual(['p2', 'p3']);
      // Totals include the partner rows: a count is public.
      expect(res.access.totals).toMatchObject({ rounds: 3, people: 3 });
    });

    it('shows a signed-in viewer partner data inside the preview', async () => {
      build(partnerCompany());
      const res = await service.getCompanyDetail('helia', user);

      expect(res.company.description).toBe('PARTNER-DESCRIPTION');
      expect(res.company.masked).toBeUndefined();
      // Partner rows count toward the two.
      expect(res.company.rounds?.map((r) => r.id)).toEqual(['r1', 'r2']);
      expect(res.company.rounds?.[0]?.investors.map((i) => i.name)).toEqual(['Public VC', 'PARTNER-VC']);
      expect(res.company.people?.map((p) => p.id)).toEqual(['p1', 'p2']);
    });

    it('builds the summary line from the latest public round for a signed-out viewer', async () => {
      build(
        dbCompany({
          rounds: [
            makeRound(1, { name: 'Seed' }),
            makeRound(2, { name: 'Series A', partnerFields: ['name'] }),
            makeRound(3, { name: 'Series B', externalSource: 'PARTNER' }),
          ],
        }),
      );
      expect((await service.getCompanyDetail('helia')).latestRound).toEqual({ stage: 'Seed', date: '2020-01-01' });
      expect((await service.getCompanyDetail('helia', user)).latestRound).toEqual({
        stage: 'Series B',
        date: '2020-03-01',
      });
    });

    it('returns a stub of a partner-only company to a signed-out viewer', async () => {
      build({ ...partnerCompany(), partnerOnly: true, partnerFields: ['description', 'totalRaisedUsd', 'hq'] });
      const res = await service.getCompanyDetail('helia');

      expect(res.company).toMatchObject({
        slug: 'helia',
        name: 'Helia',
        domain: 'helia.com',
        partnerOnly: true,
        description: '',
        hq: '',
        rounds: [],
        people: [],
      });
      expect(res.company.identifiers).toBeUndefined();
      expect(res.citations).toEqual([]);
      expect(res.access.totals.people).toBe(3);
      expect(JSON.stringify(res)).not.toContain('PARTNER-');
      expect(JSON.stringify(res)).not.toContain('Helia Payments');
    });

    it('never gives a signed-in viewer the stub', async () => {
      build({ ...partnerCompany(), partnerOnly: true });
      const res = await service.getCompanyDetail('helia', user);
      expect(res.company.partnerOnly).toBeUndefined();
      expect(res.company.description).toBe('PARTNER-DESCRIPTION');
    });
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
      // A partner-only company is a noindex stub: never in the sitemap.
      where: { moderationStatus: 'APPROVED', mergedIntoId: null, partnerOnly: false },
      select: { slug: true, updatedAt: true },
      orderBy: { slug: 'asc' },
      skip: 0,
      take: SITEMAP_PAGE_SIZE,
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

  function makeService(
    rows: ReturnType<typeof revision>[],
    company: unknown = { id: 'c1', partnerOnly: false },
    access = { unlocked: true, signedIn: true, unlockedUntil: null },
  ) {
    const findFirst = jest.fn(async () => company);
    const where = (args?: { where?: Record<string, unknown> }) =>
      rows.filter((r) => matches(r as unknown as Record<string, unknown>, args?.where));
    const count = jest.fn(async (args?: { where?: Record<string, unknown> }) => where(args).length);
    const findMany = jest.fn(async (args?: { where?: Record<string, unknown>; distinct?: string[] }) => {
      const hits = where(args);
      return args?.distinct ? [...new Map(hits.map((r) => [r.field, r])).values()] : hits;
    });
    const prisma = {
      company: {
        findFirst,
        findMany: jest.fn(async () => [{ id: 'c1', name: 'Helia' }]),
        // The miss path asks whether the slug belongs to a tombstone before
        // it 404s.
        findUnique: jest.fn(async () => null),
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
    const users = { accessFor: jest.fn(async () => access) } as unknown as UsersService;
    return {
      service: new CompaniesService(prisma, users),
      findFirst,
      findMany,
    };
  }

  it('404s for a company that is not approved', async () => {
    const { service, findFirst } = makeService([], null);

    await expect(service.getCompanyHistory('helia')).rejects.toThrow(NotFoundException);
    // The APPROVED filter is part of the query, not a post-check.
    expect(findFirst.mock.calls[0]![0]).toMatchObject({
      where: { slug: 'helia', moderationStatus: 'APPROVED', mergedIntoId: null },
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
    expect(result.hiddenCount).toBe(0);
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

    expect(items[0]!.actorName).toBe('Wikidata');
  });

  it('labels partner data generically, and never leaks an unknown tag', async () => {
    const { service } = makeService([
      revision({ actor: 'INGEST', actorSource: 'PARTNER', actorUser: null }),
      revision({ id: 'rev-x', actor: 'INGEST', actorSource: 'SOME_INTERNAL_TAG', actorUser: null }),
    ]);

    const { items } = await service.getCompanyHistory('helia');

    expect(items.map((i) => i.actorName)).toEqual(['partner', 'automated']);
  });

  describe('for a locked viewer (an allowlist)', () => {
    const locked = { unlocked: false, signedIn: true, unlockedUntil: null };
    const signedOut = { unlocked: false, signedIn: false, unlockedUntil: null };
    const everyKind = () => [
      revision({ id: 'child-create', entityType: 'round', entityId: 'r1', field: '', action: 'CREATE', after: { amountUsd: 5 } }),
      revision({ id: 'round-fix', entityType: 'round', entityId: 'r1', field: 'amountUsd', actor: 'INGEST', actorSource: 'PARTNER', actorUser: null }),
      revision({ id: 'partner-field', field: 'description', after: 'PARTNER-PROSE', actor: 'INGEST', actorSource: 'PARTNER', actorUser: null }),
      revision({ id: 'human-over-partner', field: 'description', before: 'PARTNER-PROSE', after: 'Human prose' }),
      revision({ id: 'public-ingest', field: 'hq', actor: 'INGEST', actorSource: 'COMPANIES_HOUSE', actorUser: null }),
      revision({ id: 'merge', field: '', action: 'MERGE', before: null, after: null }),
      revision({ id: 'unknown-source', field: 'stage', actor: 'INGEST', actorSource: 'SOME_NEW_SOURCE', actorUser: null }),
    ];

    it('shows only public-record company-field entries and merges, and counts the rest', async () => {
      const { service } = makeService(everyKind(), undefined, locked);
      const res = await service.getCompanyHistory('helia');

      expect(res.items.map((i) => i.id)).toEqual(['public-ingest', 'merge']);
      expect(res.total).toBe(2);
      expect(res.hiddenCount).toBe(5);
      expect(res.access).toEqual(locked);
      expect(JSON.stringify(res)).not.toContain('PARTNER-PROSE');
    });

    it('shows a signed-out viewer nothing of a partner-only company, only the count', async () => {
      const { service, findMany } = makeService(everyKind(), { id: 'c1', partnerOnly: true }, signedOut);
      const res = await service.getCompanyHistory('helia');

      expect(res.items).toEqual([]);
      expect(res.hiddenCount).toBe(7);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('shows an unlocked viewer everything', async () => {
      const { service } = makeService(everyKind());
      const res = await service.getCompanyHistory('helia');
      expect(res.items).toHaveLength(7);
      expect(res.hiddenCount).toBe(0);
    });
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

describe('CompaniesService.findFeatured (landing shop window)', () => {
  let service: CompaniesService;
  let queryRaw: jest.Mock;
  let findMany: jest.Mock<(args: { where: { id: { in: string[] } } }) => Promise<unknown[]>>;
  let accessFor: jest.Mock;
  const POOL = ['a', 'b', 'c', 'd', 'e', 'f'];

  beforeEach(() => {
    queryRaw = jest.fn(async () => POOL.map((id) => ({ id })));
    // Rows come back in arbitrary (here: reversed) order, as `IN (...)` does.
    findMany = jest.fn(async (args) =>
      [...args.where.id.in].reverse().map((id) => ({ ...dbCompany(), id, slug: id })),
    );
    const prisma = {
      $queryRaw: queryRaw,
      company: { findMany },
    } as unknown as PrismaService;
    accessFor = jest.fn(async () => ({ unlocked: false, signedIn: false, unlockedUntil: null }));
    service = new CompaniesService(prisma, { accessFor } as unknown as UsersService);
  });

  it('returns `limit` distinct companies drawn from the scored pool', async () => {
    const { items: companies } = await service.findFeatured(4);

    expect(companies).toHaveLength(4);
    const slugs = companies.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(4);
    slugs.forEach((slug) => expect(POOL).toContain(slug));
  });

  it('keeps the shuffled order rather than the database order', async () => {
    const { items: companies } = await service.findFeatured(6);
    const requested = findMany.mock.calls[0]![0].where.id.in;

    expect(companies.map((c) => c.slug)).toEqual(requested);
  });

  it('computes the pool once and reuses it across calls', async () => {
    await service.findFeatured(3);
    await service.findFeatured(3);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('returns nothing without querying rows when the pool is empty', async () => {
    queryRaw.mockResolvedValue([] as never);

    await expect(service.findFeatured(4)).resolves.toEqual({
      items: [],
      access: { unlocked: false, signedIn: false, unlockedUntil: null },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('draws a signed-out viewer only from the public-record companies in the pool', async () => {
    queryRaw.mockResolvedValue(POOL.map((id) => ({ id, partnerOnly: id !== 'a' })) as never);
    const { items } = await service.findFeatured(6);
    expect(items.map((c) => c.slug)).toEqual(['a']);
  });

  it("reports the viewer's gate state alongside the rows", async () => {
    accessFor.mockResolvedValue({ unlocked: true, signedIn: true, unlockedUntil: null } as never);
    const viewer = { id: 'admin1', role: 'ADMIN' as const };

    const { items, access } = await service.findFeatured(4, viewer);

    expect(accessFor).toHaveBeenCalledWith(viewer);
    expect(access.unlocked).toBe(true);
    // Directory rows are public: an unlocked viewer gets the same number.
    expect(items).toHaveLength(4);
  });
});

describe('CompaniesService country filter and facet', () => {
  it('scopes the directory to one country', async () => {
    const findMany = jest.fn(async () => []);
    const count = jest.fn(async () => 0);
    const prisma = {
      company: { findMany, count },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    const service = new CompaniesService(prisma, {} as UsersService);

    await service.findAllApproved({ country: 'GB' }, { id: 'u1', role: 'USER' });

    expect(count).toHaveBeenCalledWith({
      where: { moderationStatus: 'APPROVED', mergedIntoId: null, countryCode: 'GB', AND: [] },
    });
  });

  it('never lists, matches or reveals partner data to a signed-out viewer', async () => {
    const findMany = jest.fn(async () => [
      { ...dbCompany(), countryCode: 'GB', description: 'PARTNER-PROSE', partnerFields: ['description', 'stage'] },
    ]);
    const count = jest.fn(async () => 1);
    const prisma = {
      company: { findMany, count },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    const service = new CompaniesService(prisma, {} as UsersService);

    const page = await service.findAllApproved({ country: 'GB', q: 'acme' });

    expect(count).toHaveBeenCalledWith({
      where: {
        moderationStatus: 'APPROVED',
        mergedIntoId: null,
        partnerOnly: false,
        OR: [
          { name: { contains: 'acme', mode: 'insensitive' } },
          { oneLiner: { contains: 'acme', mode: 'insensitive' }, NOT: { partnerFields: { has: 'oneLiner' } } },
        ],
        countryCode: 'GB',
        AND: [{ NOT: { partnerFields: { has: 'countryCode' } } }],
      },
    });
    expect(page.items[0]).toMatchObject({ description: '', stage: '', masked: ['description', 'stage'] });
    expect(JSON.stringify(page)).not.toContain('PARTNER-PROSE');
  });

  it('counts public rows with a stated country only, most first, and caches the result', async () => {
    const groupBy = jest.fn(async () => [
      { countryCode: 'GB', _count: { _all: 120_000 } },
      { countryCode: 'US', _count: { _all: 29_000 } },
      { countryCode: 'CA', _count: { _all: 189 } },
      { countryCode: 'BE', _count: { _all: 189 } },
    ]);
    const prisma = { company: { groupBy } } as unknown as PrismaService;
    const service = new CompaniesService(prisma, {} as UsersService);

    const facets = await service.countries();
    await service.countries();

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['countryCode'],
      // Merged-away and unapproved rows never count.
      where: { moderationStatus: 'APPROVED', mergedIntoId: null, countryCode: { not: null } },
      _count: { _all: true },
    });
    expect(facets).toEqual([
      { code: 'GB', count: 120_000 },
      { code: 'US', count: 29_000 },
      { code: 'BE', count: 189 },
      { code: 'CA', count: 189 },
    ]);
  });
});

describe('CompaniesService domain lookup (public API de-duplication)', () => {
  const service = () => {
    const findMany = jest.fn(async () => []);
    const count = jest.fn(async () => 0);
    const prisma = {
      company: { findMany, count },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    return { service: new CompaniesService(prisma, {} as UsersService), count };
  };

  it('matches the normalised host and its legacy www. form', async () => {
    const { service: s, count } = service();
    // /v1 only: a key owner is always signed in.
    await s.findAllApproved({ domain: 'https://WWW.Example.com/about' }, { id: 'k1', role: 'CONTRIBUTOR' });
    expect(count).toHaveBeenCalledWith({
      where: {
        moderationStatus: 'APPROVED',
        mergedIntoId: null,
        domain: { in: ['example.com', 'www.example.com'] },
        AND: [],
      },
    });
  });

  it('matches nothing for an input with no host, never the empty-domain rows', async () => {
    const { service: s, count } = service();
    await s.findAllApproved({ domain: '  ' }, { id: 'k1', role: 'CONTRIBUTOR' });
    expect(count).toHaveBeenCalledWith({
      where: { moderationStatus: 'APPROVED', mergedIntoId: null, domain: { in: [] }, AND: [] },
    });
  });

  it('stores a contributed domain as the bare lower-case host', async () => {
    const create = jest.fn(async () => ({ id: 'c1', slug: 'acme', moderationStatus: 'PENDING' }));
    const prisma = {
      company: { create, findUnique: jest.fn(async () => null) },
    } as unknown as PrismaService;
    await new CompaniesService(prisma, {} as UsersService).createCompany(
      { name: 'Acme', domain: 'https://www.Acme.com/', industry: [], totalRaisedUsd: 0 } as never,
      'u1',
    );
    const { data } = (create.mock.calls[0] as unknown[])[0] as { data: { domain: string } };
    expect(data.domain).toBe('acme.com');
  });
});
