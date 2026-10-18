import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { SITEMAP_PAGE_SIZE } from '@repo/api';
import request from 'supertest';

import { ApiKeysService } from './../src/api-keys/api-keys.service';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// The read gate, end to end: two rules applied in the API so a hidden value
// never reaches the browser — by section (`GATED_SECTIONS`) and by provenance
// (partner rows, partner fields, partner-only entities). This seeds public and
// partner rows carrying sentinel values, fetches every surface as a signed-out
// viewer, a signed-in viewer without a contribution and a contributor, and
// asserts the counts per tier and that no response carries a sentinel its tier
// excludes. Requires Postgres running and migrated; seeds and removes its own
// rows.
//
// No /auth calls (throttled at 20/min across the whole run): users are created
// with Prisma and their JWTs signed with the app's JwtService. Cleanup deletes
// only ids this suite created, each guarded — a `where: { id: undefined }` is
// NO filter in Prisma and would delete every row.
const SITEMAP_TIMEOUT_MS = 60_000;

describe('Read gate (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const tag = `e2e-gate-${stamp}`;
  const http = () => request(app.getHttpServer());

  // Sentinels: each string appears in exactly one gated place.
  const S = {
    description: `partner-description-${stamp}`,
    roundName: `partner-round-${stamp}`,
    correctedAmount: 271_828_271,
    roundInvestor: `partner-round-investor-${stamp}`,
    role: `partner-role-${stamp}`,
    holding: `partner-holding-${stamp}`,
    poDescription: `partner-only-description-${stamp}`,
    firmDescription: `partner-firm-description-${stamp}`,
    firmPerson: `partner-firm-person-${stamp}`,
    fee: 2.71828,
    aum: 314_159_265,
    fundHq: `partner-fund-hq-${stamp}`,
    personTitle: `partner-person-title-${stamp}`,
  };
  const names = {
    publicCo: `Gate Public Co ${stamp}`,
    partnerCo: `Gate Partner Only Co ${stamp}`,
    firm: `Gate ADV Firm ${stamp}`,
    partnerFirm: `Gate Partner Firm ${stamp}`,
    fund: `Gate SEC Fund ${stamp}`,
    partnerFund: `Gate Partner Fund ${stamp}`,
    partnerPerson: `Gate Partner Person ${stamp}`,
  };
  const slugs = {
    publicCo: `${tag}-pub`,
    partnerCo: `${tag}-po`,
    firm: `${tag}-firm`,
    partnerFirm: `${tag}-pfirm`,
    fund: `${tag}-fund`,
    partnerFund: `${tag}-pfund`,
    partnerPerson: `${tag}-pperson`,
  };

  const ids: Record<string, string | undefined> = {};
  const tokens: { locked?: string; contributor?: string } = {};

  const base = {
    domain: '',
    oneLiner: '',
    description: '',
    hq: 'Undisclosed',
    founded: 0,
    headcount: 0,
    status: 'Private',
    stage: 'Seed',
    totalRaisedUsd: 0n,
    moderationStatus: 'APPROVED' as const,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    // --- A public SEC company the partner enriched and added rows to.
    ids.publicCo = (
      await prisma.company.create({
        data: {
          ...base,
          slug: slugs.publicCo,
          name: names.publicCo,
          description: S.description,
          partnerFields: ['description'],
          externalSource: 'SEC_EDGAR',
          externalId: `${tag}-pub`,
        },
        select: { id: true },
      })
    ).id;
    const round = (n: number, data: Record<string, unknown>) =>
      prisma.fundingRound.create({
        data: {
          companyId: ids.publicCo!,
          name: `Round ${n}`,
          date: new Date(`2020-0${n}-01`),
          amountUsd: 1_000_000n,
          moderationStatus: 'APPROVED',
          externalId: `${tag}-r${n}`,
          ...data,
        },
        select: { id: true },
      });
    ids.r1 = (await round(1, { name: 'Seed', externalSource: 'SEC_EDGAR' })).id;
    ids.r2 = (await round(2, { name: S.roundName, externalSource: 'PARTNER' })).id;
    ids.r3 = (
      await round(3, { externalSource: 'SEC_EDGAR', amountUsd: BigInt(S.correctedAmount), partnerFields: ['amountUsd'] })
    ).id;
    await prisma.roundInvestor.createMany({
      data: [
        { roundId: ids.r1, name: 'Public VC', lead: true },
        { roundId: ids.r1, name: S.roundInvestor, externalSource: 'PARTNER' },
      ],
    });
    await prisma.personRole.createMany({
      data: [
        { companyId: ids.publicCo, name: 'Public Officer', role: 'CEO', since: 2020, externalSource: 'SEC_EDGAR', externalId: `${tag}-role-pub`, moderationStatus: 'APPROVED' },
        { companyId: ids.publicCo, name: S.role, role: 'Partner', since: 2021, externalSource: 'PARTNER', externalId: `${tag}-role-p`, moderationStatus: 'APPROVED' },
      ],
    });
    await prisma.investorHolding.createMany({
      data: [
        { companyId: ids.publicCo, name: 'Public Holder', type: 'Venture', firstRound: 'Seed', rounds: 1, externalSource: 'WIKIDATA', externalId: `${tag}-h-pub`, moderationStatus: 'APPROVED' },
        { companyId: ids.publicCo, name: S.holding, type: 'Venture', firstRound: 'Seed', rounds: 1, externalSource: 'PARTNER', externalId: `${tag}-h-p`, moderationStatus: 'APPROVED' },
      ],
    });
    // One revision of every kind.
    const rev = (data: Record<string, unknown>) => ({
      companyId: ids.publicCo!,
      entityType: 'company',
      entityId: ids.publicCo!,
      action: 'UPDATE',
      ...data,
    });
    await prisma.revision.createMany({
      data: [
        rev({ entityType: 'round', entityId: ids.r1, field: '', action: 'CREATE', after: { name: S.roundName }, actor: 'ADMIN' }),
        rev({ entityType: 'round', entityId: ids.r3, field: 'amountUsd', before: 0, after: S.correctedAmount, actor: 'INGEST', actorSource: 'PARTNER' }),
        rev({ field: 'description', before: '', after: S.description, actor: 'INGEST', actorSource: 'PARTNER' }),
        rev({ field: 'description', before: S.description, after: 'Human prose', actor: 'ADMIN' }),
        rev({ field: 'hq', before: 'Undisclosed', after: 'London', actor: 'INGEST', actorSource: 'COMPANIES_HOUSE' }),
        rev({ field: '', action: 'MERGE', actor: 'ADMIN' }),
      ],
    });

    // --- A company only the partner knows.
    ids.partnerCo = (
      await prisma.company.create({
        data: {
          ...base,
          slug: slugs.partnerCo,
          name: names.partnerCo,
          description: S.poDescription,
          partnerFields: ['description', 'stage'],
          partnerOnly: true,
          externalSource: 'PARTNER',
          externalId: `${tag}-po`,
        },
        select: { id: true },
      })
    ).id;

    // --- An ADV firm the partner enriched, with a partner officer and an LP commitment.
    ids.firm = (
      await prisma.investor.create({
        data: {
          slug: slugs.firm,
          name: names.firm,
          type: 'Venture',
          description: S.firmDescription,
          partnerFields: ['description'],
          externalSource: 'SEC_ADV',
          externalId: `${tag}-firm`,
          moderationStatus: 'APPROVED',
        },
        select: { id: true },
      })
    ).id;
    ids.partnerFirm = (
      await prisma.investor.create({
        data: {
          slug: slugs.partnerFirm,
          name: names.partnerFirm,
          type: 'Pension fund',
          partnerFields: ['type'],
          partnerOnly: true,
          externalSource: 'PARTNER',
          externalId: `${tag}-pfirm`,
          moderationStatus: 'APPROVED',
        },
        select: { id: true },
      })
    ).id;

    // --- An SEC fund with partner terms and metrics, and a partner-only fund.
    ids.fund = (
      await prisma.fund.create({
        data: {
          slug: slugs.fund,
          name: names.fund,
          managerId: ids.firm,
          strategy: 'Venture capital',
          status: 'Closed',
          managementFeePct: S.fee,
          partnerFields: ['managementFeePct', 'status'],
          externalSource: 'SEC_ADV_FUNDS',
          externalId: `${tag}-fund`,
          moderationStatus: 'APPROVED',
        },
        select: { id: true },
      })
    ).id;
    await prisma.fundMetric.create({
      data: { fundId: ids.fund, asAt: new Date('2024-06-30'), aumUsd: BigInt(S.aum), externalSource: 'PARTNER' },
    });
    ids.partnerFund = (
      await prisma.fund.create({
        data: {
          slug: slugs.partnerFund,
          name: names.partnerFund,
          managerId: ids.partnerFirm,
          hq: S.fundHq,
          partnerFields: ['hq'],
          partnerOnly: true,
          externalSource: 'PARTNER',
          externalId: `${tag}-pfund`,
          moderationStatus: 'APPROVED',
        },
        select: { id: true },
      })
    ).id;
    // The partner firm commits to the SEC fund, as an LP.
    await prisma.fundCommitment.create({
      data: {
        fundId: ids.fund,
        investorId: ids.partnerFirm,
        amountUsd: 5_000_000n,
        externalSource: 'PARTNER',
        externalId: `${tag}-commit`,
        moderationStatus: 'APPROVED',
      },
    });

    // --- A partner person, officer of the ADV firm.
    ids.partnerPerson = (
      await prisma.person.create({
        data: {
          slug: slugs.partnerPerson,
          name: names.partnerPerson,
          normalizedName: names.partnerPerson.toLowerCase(),
          identifierOnly: true,
          moderationStatus: 'APPROVED',
        },
        select: { id: true },
      })
    ).id;
    await prisma.personRole.create({
      data: {
        investorId: ids.firm,
        personId: ids.partnerPerson,
        name: names.partnerPerson,
        role: S.personTitle,
        title: S.personTitle,
        since: 2022,
        externalSource: 'PARTNER',
        externalId: `${tag}-pperson`,
        moderationStatus: 'APPROVED',
      },
    });

    // --- Viewers.
    const jwt = app.get(JwtService);
    for (const role of ['USER', 'CONTRIBUTOR'] as const) {
      const user = await prisma.user.create({
        data: {
          email: `${tag}-${role.toLowerCase()}@test.dev`,
          name: `Gate ${role}`,
          passwordHash: 'unused',
          role,
          emailVerifiedAt: new Date(),
        },
        select: { id: true, email: true, tokenVersion: true },
      });
      ids[`user-${role}`] = user.id;
      const token = jwt.sign({ sub: user.id, email: user.email, role, tv: user.tokenVersion });
      if (role === 'USER') tokens.locked = token;
      else tokens.contributor = token;
    }
  }, SITEMAP_TIMEOUT_MS);

  afterAll(async () => {
    for (const role of ['USER', 'CONTRIBUTOR']) {
      const id = ids[`user-${role}`];
      if (id) await prisma.user.delete({ where: { id } });
    }
    if (ids.partnerPerson) {
      await prisma.personRole.deleteMany({ where: { personId: ids.partnerPerson } });
      await prisma.person.delete({ where: { id: ids.partnerPerson } });
    }
    // Funds cascade their metrics and commitments; firms their remaining roles.
    if (ids.partnerFund) await prisma.fund.delete({ where: { id: ids.partnerFund } });
    if (ids.fund) await prisma.fund.delete({ where: { id: ids.fund } });
    if (ids.firm) await prisma.investor.delete({ where: { id: ids.firm } });
    if (ids.partnerFirm) await prisma.investor.delete({ where: { id: ids.partnerFirm } });
    // Companies cascade rounds (and their investors), roles, holdings, revisions.
    if (ids.publicCo) await prisma.company.delete({ where: { id: ids.publicCo } });
    if (ids.partnerCo) await prisma.company.delete({ where: { id: ids.partnerCo } });
    await app.close();
  });

  type Viewer = 'signedOut' | 'locked' | 'contributor';
  const get = (path: string, viewer: Viewer) => {
    const req = http().get(path);
    const token = viewer === 'signedOut' ? undefined : tokens[viewer];
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).expect(200);
  };
  const text = (body: unknown) => JSON.stringify(body);
  /** Sentinels as they appear in JSON (numbers bare). */
  const leaks = (body: unknown, sentinels: (string | number)[]) =>
    sentinels.filter((s) => text(body).includes(String(s)));

  describe('company profile', () => {
    it('signed out: no money sections, public-only previews, partner fields masked, counts public', async () => {
      const { body } = await get(`/companies/${slugs.publicCo}`, 'signedOut');
      expect(body.company.rounds).toEqual([]);
      expect(body.company.people.map((p: { name: string }) => p.name)).toEqual(['Public Officer']);
      expect(body.company.investors.map((i: { name: string }) => i.name)).toEqual(['Public Holder']);
      expect(body.company.masked).toEqual(['description']);
      expect(body.access).toMatchObject({ unlocked: false, signedIn: false });
      expect(body.access.totals).toMatchObject({ rounds: 3, people: 2, investors: 2 });
      // Round 3 is public — only its amount is the partner's — so it leads the
      // summary line; round 2 (the partner's own) never does.
      expect(body.latestRound).toEqual({ stage: 'Round 3', date: '2020-03-01' });
      expect(leaks(body, [S.description, S.roundName, S.correctedAmount, S.roundInvestor, S.role, S.holding])).toEqual([]);
    });

    it('signed in: two rows of every section, partner rows included, partner fields shown', async () => {
      const { body } = await get(`/companies/${slugs.publicCo}`, 'locked');
      expect(body.company.rounds.map((r: { id: string }) => r.id)).toEqual([ids.r1, ids.r2]);
      expect(body.company.description).toBe(S.description);
      expect(body.company.masked).toBeUndefined();
      expect(text(body)).toContain(S.roundInvestor);
      // The third round was never loaded.
      expect(leaks(body, [S.correctedAmount])).toEqual([]);
    });

    it('contributor: everything', async () => {
      const { body } = await get(`/companies/${slugs.publicCo}`, 'contributor');
      expect(body.company.rounds).toHaveLength(3);
      expect(body.access.unlocked).toBe(true);
      expect(leaks(body, [S.description, S.roundName, S.correctedAmount, S.roundInvestor, S.role, S.holding])).toHaveLength(6);
    });

    it('a partner-only company is a stub signed out and a profile signed in', async () => {
      const out = await get(`/companies/${slugs.partnerCo}`, 'signedOut');
      expect(out.body.company).toMatchObject({ name: names.partnerCo, partnerOnly: true, rounds: [] });
      expect(out.body.citations).toEqual([]);
      expect(leaks(out.body, [S.poDescription])).toEqual([]);

      const locked = await get(`/companies/${slugs.partnerCo}`, 'locked');
      expect(locked.body.company.partnerOnly).toBeUndefined();
      expect(locked.body.company.description).toBe(S.poDescription);
    });
  });

  describe('company history', () => {
    it.each(['signedOut', 'locked'] as const)('%s: only public-record company-field entries and merges', async (viewer) => {
      const { body } = await get(`/companies/${slugs.publicCo}/history`, viewer);
      expect(body.items.map((i: { field: string; action: string }) => `${i.action}:${i.field}`).sort()).toEqual([
        'MERGE:',
        'UPDATE:hq',
      ]);
      expect(body.hiddenCount).toBe(4);
      expect(leaks(body, [S.description, S.roundName, S.correctedAmount])).toEqual([]);
    });

    it('contributor: every entry', async () => {
      const { body } = await get(`/companies/${slugs.publicCo}/history`, 'contributor');
      expect(body.items).toHaveLength(6);
      expect(body.hiddenCount).toBe(0);
    });

    it('a partner-only company shows a signed-out viewer nothing', async () => {
      const { body } = await get(`/companies/${slugs.partnerCo}/history`, 'signedOut');
      expect(body.items).toEqual([]);
    });
  });

  describe('investor profile', () => {
    it('signed out: partner fields masked, no partner people, no LP commitments', async () => {
      const { body } = await get(`/investors/${slugs.firm}`, 'signedOut');
      expect(body.description).toBeNull();
      expect(body.masked).toEqual(['description']);
      expect(body.people).toEqual([]);
      expect(body.peopleCount).toBe(1);
      expect(body.funds.map((f: { slug: string }) => f.slug)).toEqual([slugs.fund]);
      expect(body.funds[0].status).toBeNull();
      expect(leaks(body, [S.firmDescription, S.personTitle, S.fee])).toEqual([]);
    });

    it('signed in: partner people and values shown', async () => {
      const { body } = await get(`/investors/${slugs.firm}`, 'locked');
      expect(body.description).toBe(S.firmDescription);
      expect(text(body)).toContain(S.personTitle);
    });

    it('a partner-only firm is a stub signed out, never indexable', async () => {
      const out = await get(`/investors/${slugs.partnerFirm}`, 'signedOut');
      expect(out.body).toMatchObject({ partnerOnly: true, indexable: false, commitments: [], commitmentCount: 1 });
      const locked = await get(`/investors/${slugs.partnerFirm}`, 'locked');
      expect(locked.body.partnerOnly).toBeUndefined();
      expect(locked.body.commitments).toHaveLength(1);
    });
  });

  describe('fund page', () => {
    it('signed out: terms, metrics and commitments withheld, partner status masked', async () => {
      const { body } = await get(`/funds/${slugs.fund}`, 'signedOut');
      expect(body.fund.managementFeePct).toBeNull();
      expect(body.fund.status).toBeNull();
      expect(body.termsHidden).toBe(true);
      expect(body.metrics).toEqual([]);
      expect(body.metricCount).toBe(1);
      expect(body.commitments).toEqual([]);
      expect(body.commitmentCount).toBe(1);
      expect(leaks(body, [S.fee, S.aum])).toEqual([]);
    });

    it('signed in: metrics, commitments and status — still no terms', async () => {
      const { body } = await get(`/funds/${slugs.fund}`, 'locked');
      expect(body.fund.status).toBe('Closed');
      expect(body.metrics).toHaveLength(1);
      expect(body.commitments).toHaveLength(1);
      expect(body.termsHidden).toBe(true);
      expect(leaks(body, [S.fee])).toEqual([]);
    });

    it('contributor: the terms', async () => {
      const { body } = await get(`/funds/${slugs.fund}`, 'contributor');
      expect(body.fund.managementFeePct).toBe(S.fee);
      expect(body.termsHidden).toBe(false);
    });

    it('a partner-only fund is a stub signed out', async () => {
      const out = await get(`/funds/${slugs.partnerFund}`, 'signedOut');
      expect(out.body.fund).toMatchObject({ name: names.partnerFund, partnerOnly: true });
      expect(leaks(out.body, [S.fundHq])).toEqual([]);
      const locked = await get(`/funds/${slugs.partnerFund}`, 'locked');
      expect(locked.body.fund.hq).toBe(S.fundHq);
    });
  });

  describe('person profile', () => {
    it('a partner person is a stub signed out and a profile signed in', async () => {
      const out = await get(`/people/${slugs.partnerPerson}`, 'signedOut');
      expect(out.body).toMatchObject({ name: names.partnerPerson, partnerOnly: true, roles: [], roleCount: 1, indexable: false });
      expect(leaks(out.body, [S.personTitle])).toEqual([]);
      const locked = await get(`/people/${slugs.partnerPerson}`, 'locked');
      expect(locked.body.roles).toHaveLength(1);
      expect(text(locked.body)).toContain(S.personTitle);
    });
  });

  describe('directories and search', () => {
    const q = encodeURIComponent(String(stamp));
    const slugsOf = (body: { items: { slug: string }[] }) => body.items.map((i) => i.slug).sort();

    it('signed out: no partner-only entity is listed, partner values are masked', async () => {
      const companies = await get(`/companies?q=${q}`, 'signedOut');
      expect(slugsOf(companies.body)).toEqual([slugs.publicCo]);
      expect(companies.body.items[0].masked).toEqual(['description']);
      expect(leaks(companies.body, [S.description, S.poDescription])).toEqual([]);

      const investors = await get(`/investors?q=${q}`, 'signedOut');
      expect(slugsOf(investors.body)).toEqual([slugs.firm]);
      expect(leaks(investors.body, [S.firmDescription])).toEqual([]);

      const funds = await get(`/funds?q=${q}`, 'signedOut');
      expect(slugsOf(funds.body)).toEqual([slugs.fund]);
      expect(funds.body.items[0].status).toBeNull();

      const people = await get(`/people?q=${q}`, 'signedOut');
      expect(slugsOf(people.body)).toEqual([]);

      const search = await get(`/search?q=${q}`, 'signedOut');
      expect(search.body.companies.map((h: { slug: string }) => h.slug)).toEqual([slugs.publicCo]);
      expect(search.body.investors.map((h: { slug: string }) => h.slug)).toEqual([slugs.firm]);
      expect(search.body.people).toEqual([]);
    });

    it('signed out: a filter never matches a partner-written value', async () => {
      const { body } = await get(`/funds?q=${q}&status=Closed`, 'signedOut');
      // The status filter is ignored outright signed out (a partner-only column).
      expect(slugsOf(body)).toEqual([slugs.fund]);
      expect(body.items[0].status).toBeNull();
    });

    it('signed in: every entity listed, with partner values', async () => {
      const companies = await get(`/companies?q=${q}`, 'locked');
      expect(slugsOf(companies.body)).toEqual([slugs.publicCo, slugs.partnerCo].sort());
      const investors = await get(`/investors?q=${q}`, 'locked');
      expect(slugsOf(investors.body)).toEqual([slugs.firm, slugs.partnerFirm].sort());
      const funds = await get(`/funds?q=${q}`, 'locked');
      expect(slugsOf(funds.body)).toEqual([slugs.fund, slugs.partnerFund].sort());
      const people = await get(`/people?q=${q}`, 'locked');
      expect(slugsOf(people.body)).toEqual([slugs.partnerPerson]);
      const search = await get(`/search?q=${q}`, 'locked');
      expect(search.body.people.map((h: { slug: string }) => h.slug)).toEqual([slugs.partnerPerson]);
    });
  });

  describe('sitemap', () => {
    it(
      'lists the public company and never the partner-only stub',
      async () => {
        // Both slugs share the tag, so they sit on the same page of the
        // slug-ordered feed: the page holding the public one.
        const before = await prisma.company.count({
          where: { moderationStatus: 'APPROVED', mergedIntoId: null, partnerOnly: false, slug: { lt: slugs.publicCo } },
        });
        const page = Math.floor(before / SITEMAP_PAGE_SIZE);
        const { body } = await get(`/companies/sitemap?page=${page}`, 'signedOut');
        const listed = new Set((body as { slug: string }[]).map((e) => e.slug));
        expect(listed.has(slugs.publicCo)).toBe(true);
        expect(listed.has(slugs.partnerCo)).toBe(false);
      },
      SITEMAP_TIMEOUT_MS,
    );
  });

  describe('/v1', () => {
    it('gives a contributor key everything — its owner is unlocked', async () => {
      const key = (
        await app.get(ApiKeysService).create(
          { id: ids['user-CONTRIBUTOR']!, role: 'CONTRIBUTOR', emailVerified: true },
          { name: tag, scope: 'contributor' },
        )
      ).token;
      const v1 = (path: string) => http().get(path).set('Authorization', `Bearer ${key}`).expect(200);
      expect((await v1(`/v1/funds/${slugs.fund}`)).body.fund.managementFeePct).toBe(S.fee);
      expect((await v1(`/v1/companies/${slugs.publicCo}`)).body.company.rounds).toHaveLength(3);
      expect((await v1(`/v1/people/${slugs.partnerPerson}`)).body.roles).toHaveLength(1);
    });
  });
});
