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

  // Sentinels distinguish public prose from fields and rows that stay gated.
  const S = {
    description: `partner-description-${stamp}`,
    oneLiner: `partner-oneliner-${stamp}`,
    hq: `partner-hq-${stamp}`,
    firmHq: `partner-firm-hq-${stamp}`,
    poOneLiner: `partner-only-oneliner-${stamp}`,
    pfirmDescription: `partner-only-firm-description-${stamp}`,
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
    partnerCoBare: `Gate Partner Bare Co ${stamp}`,
    firm: `Gate ADV Firm ${stamp}`,
    partnerFirm: `Gate Partner Firm ${stamp}`,
    fund: `Gate SEC Fund ${stamp}`,
    partnerFund: `Gate Partner Fund ${stamp}`,
    partnerPerson: `Gate Partner Person ${stamp}`,
    // No stamp: the directory tests search by it and must not see these two.
    backersCo: 'Gate Backers Co',
    backerFirm: 'Gate Backer Firm',
  };
  const slugs = {
    publicCo: `${tag}-pub`,
    partnerCo: `${tag}-po`,
    partnerCoBare: `${tag}-po-bare`,
    firm: `${tag}-firm`,
    partnerFirm: `${tag}-pfirm`,
    fund: `${tag}-fund`,
    partnerFund: `${tag}-pfund`,
    partnerPerson: `${tag}-pperson`,
    backersCo: `${tag}-backers`,
    backerFirm: `${tag}-bfirm`,
  };

  const ids: Record<string, string | undefined> = {};
  const tokens: { locked?: string; contributor?: string; admin?: string } = {};

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
          oneLiner: S.oneLiner,
          hq: S.hq,
          partnerFields: ['hq', 'oneLiner', 'description'],
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
          oneLiner: S.poOneLiner,
          partnerFields: ['oneLiner', 'description', 'stage'],
          partnerOnly: true,
          externalSource: 'PARTNER',
          externalId: `${tag}-po`,
        },
        select: { id: true },
      })
    ).id;

    ids.partnerCoBare = (await prisma.company.create({
      data: { ...base, slug: slugs.partnerCoBare, name: names.partnerCoBare, partnerOnly: true },
      select: { id: true },
    })).id;

    // --- An ADV firm the partner enriched, with a partner officer and an LP commitment.
    ids.firm = (
      await prisma.investor.create({
        data: {
          slug: slugs.firm,
          name: names.firm,
          type: 'Venture',
          description: S.firmDescription,
          hq: S.firmHq,
          partnerFields: ['hq', 'description'],
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
          description: S.pfirmDescription,
          partnerFields: ['type', 'description'],
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

    // --- A public company with three backers: holdings sort by rounds
    // recorded, and a linked firm's own name replaces the holding's.
    ids.backerFirm = (
      await prisma.investor.create({
        data: {
          slug: slugs.backerFirm,
          name: names.backerFirm,
          type: 'Venture',
          externalSource: 'SEC_ADV',
          externalId: `${tag}-bfirm`,
          moderationStatus: 'APPROVED',
        },
        select: { id: true },
      })
    ).id;
    ids.backersCo = (
      await prisma.company.create({
        data: { ...base, slug: slugs.backersCo, name: names.backersCo, externalSource: 'SEC_EDGAR', externalId: `${tag}-backers` },
        select: { id: true },
      })
    ).id;
    await prisma.investorHolding.createMany({
      data: [
        { companyId: ids.backersCo, name: 'Backer One', type: 'Venture', firstRound: 'Seed', rounds: 1, externalSource: 'WIKIDATA', externalId: `${tag}-bh-1`, moderationStatus: 'APPROVED' },
        { companyId: ids.backersCo, investorId: ids.backerFirm, name: 'GBF', type: 'Venture', firstRound: 'Seed', rounds: 3, externalSource: 'PARTNER', externalId: `${tag}-bh-3`, moderationStatus: 'APPROVED' },
        { companyId: ids.backersCo, name: 'Backer Two', type: 'Venture', firstRound: 'Series A', rounds: 2, externalSource: 'WIKIDATA', externalId: `${tag}-bh-2`, moderationStatus: 'APPROVED' },
      ],
    });

    // --- Viewers.
    const jwt = app.get(JwtService);
    for (const role of ['USER', 'CONTRIBUTOR', 'ADMIN'] as const) {
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
      else if (role === 'CONTRIBUTOR') tokens.contributor = token;
      else tokens.admin = token;
    }
  }, SITEMAP_TIMEOUT_MS);

  afterAll(async () => {
    for (const role of ['USER', 'CONTRIBUTOR', 'ADMIN']) {
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
    if (ids.backerFirm) await prisma.investor.delete({ where: { id: ids.backerFirm } });
    // Companies cascade rounds (and their investors), roles, holdings, revisions.
    if (ids.publicCo) await prisma.company.delete({ where: { id: ids.publicCo } });
    if (ids.partnerCo) await prisma.company.delete({ where: { id: ids.partnerCo } });
    if (ids.partnerCoBare) await prisma.company.delete({ where: { id: ids.partnerCoBare } });
    if (ids.backersCo) await prisma.company.delete({ where: { id: ids.backersCo } });
    await app.close();
  });

  type Viewer = 'signedOut' | 'locked' | 'contributor' | 'admin';
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
      expect(body.company.masked).toEqual(['hq']);
      expect(body.company.description).toBe(S.description);
      expect(body.company.oneLiner).toBe(S.oneLiner);
      expect(body.indexable).toBe(true);
      expect(body.access).toMatchObject({ unlocked: false, signedIn: false });
      expect(body.access.totals).toMatchObject({ rounds: 3, people: 2, investors: 2 });
      // Round 3 is public — only its amount is the partner's — so it leads the
      // summary line; round 2 (the partner's own) never does.
      expect(body.latestRound).toEqual({ stage: 'Round 3', date: '2020-03-01' });
      expect(leaks(body, [S.hq, S.roundName, S.correctedAmount, S.roundInvestor, S.role, S.holding])).toEqual([]);
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
      expect(out.body.company).toMatchObject({ oneLiner: S.poOneLiner, description: S.poDescription, hq: '', stage: '', people: [], investors: [] });
      expect(out.body.company.masked).toEqual(expect.arrayContaining(['hq', 'stage']));
      expect(out.body.company.masked).not.toContain('description');
      expect(out.body.company.masked).not.toContain('oneLiner');
      expect(out.body.indexable).toBe(true);
      expect(out.body.company.identifiers).toBeUndefined();

      const locked = await get(`/companies/${slugs.partnerCo}`, 'locked');
      expect(locked.body.company.partnerOnly).toBeUndefined();
      expect(locked.body.company.description).toBe(S.poDescription);
      expect(locked.body.indexable).toBe(true);
    });
  });

  describe('company backers', () => {
    const backerNames = (body: { company: { investors: { name: string }[] } }) => body.company.investors.map((i) => i.name);

    it('unlocked: every backer, most rounds first, under the linked firm’s name', async () => {
      const { body } = await get(`/companies/${slugs.backersCo}`, 'contributor');
      expect(backerNames(body)).toEqual([names.backerFirm, 'Backer Two', 'Backer One']);
      expect(body.company.investors[0].slug).toBe(slugs.backerFirm);
      expect(text(body)).not.toContain('"GBF"');
    });

    it('signed in but locked: the two most active backers', async () => {
      const { body } = await get(`/companies/${slugs.backersCo}`, 'locked');
      expect(backerNames(body)).toEqual([names.backerFirm, 'Backer Two']);
      expect(body.access.totals).toMatchObject({ investors: 3 });
    });

    it('signed out: only non-partner backers, in the same order', async () => {
      const { body } = await get(`/companies/${slugs.backersCo}`, 'signedOut');
      expect(backerNames(body)).toEqual(['Backer Two', 'Backer One']);
      expect(leaks(body, [names.backerFirm, 'GBF'])).toEqual([]);
    });
  });

  it('keeps a partner-only company without prose unindexable for every viewer', async () => {
    for (const viewer of ['signedOut', 'locked'] as const) {
      expect((await get(`/companies/${slugs.partnerCoBare}`, viewer)).body.indexable).toBe(false);
    }
  });

  describe('company history', () => {
    const path = () => `/companies/${slugs.publicCo}/history`;
    const denied = (body: unknown) => {
      expect(body).not.toHaveProperty('items');
      expect(body).not.toHaveProperty('total');
      expect(body).not.toHaveProperty('hiddenCount');
      expect(leaks(body, [S.description, S.roundName, S.correctedAmount])).toEqual([]);
    };

    it('anonymous and invalid JWT receive 401 without history data', async () => {
      denied((await http().get(path()).expect(401)).body);
      denied((await http().get(path()).set('Authorization', 'Bearer invalid').expect(401)).body);
      await http().get(`/companies/${slugs.partnerCo}/history`).expect(401);
    });

    it('USER receives 403, even after a recent approved contribution unlocks profiles', async () => {
      denied((await http().get(path()).set('Authorization', `Bearer ${tokens.locked}`).expect(403)).body);
      const contribution = await prisma.changeProposal.create({
        data: { companyId: ids.publicCo!, submittedById: ids['user-USER']!, changes: { hq: 'London' }, moderationStatus: 'APPROVED' },
      });
      try {
        expect((await get(`/companies/${slugs.publicCo}`, 'locked')).body.access.unlocked).toBe(true);
        denied((await http().get(path()).set('Authorization', `Bearer ${tokens.locked}`).expect(403)).body);
      } finally {
        await prisma.changeProposal.delete({ where: { id: contribution.id } });
      }
    });

    it.each(['contributor', 'admin'] as const)('%s: every entry with capped pagination', async (viewer) => {
      const { body } = await get(path(), viewer);
      expect(body.items).toHaveLength(6);
      expect(body.hiddenCount).toBe(0);
      const page = await get(`${path()}?page=2&pageSize=2`, viewer);
      expect(page.body).toMatchObject({ page: 2, pageSize: 2, total: 6, hiddenCount: 0 });
      expect(page.body.items).toHaveLength(2);
      await http().get(`${path()}?pageSize=101`).set('Authorization', `Bearer ${tokens[viewer]}`).expect(400);
    });

    it('ban, token revocation and demotion take effect on the next history request', async () => {
      const id = ids['user-CONTRIBUTOR']!;
      try {
        await prisma.user.update({ where: { id }, data: { bannedAt: new Date() } });
        denied((await http().get(path()).set('Authorization', `Bearer ${tokens.contributor}`).expect(401)).body);
        await prisma.user.update({ where: { id }, data: { bannedAt: null, tokenVersion: 1 } });
        denied((await http().get(path()).set('Authorization', `Bearer ${tokens.contributor}`).expect(401)).body);
        await prisma.user.update({ where: { id }, data: { tokenVersion: 0, role: 'USER' } });
        denied((await http().get(path()).set('Authorization', `Bearer ${tokens.contributor}`).expect(403)).body);
      } finally {
        await prisma.user.update({ where: { id }, data: { role: 'CONTRIBUTOR', bannedAt: null, tokenVersion: 0 } });
      }
    });
  });

  describe('investor profile', () => {
    it('signed out: partner fields masked, no partner people, no LP commitments', async () => {
      const { body } = await get(`/investors/${slugs.firm}`, 'signedOut');
      expect(body.description).toBe(S.firmDescription);
      expect(body.masked).toEqual(['hq']);
      expect(body.indexable).toBe(true);
      expect(body.people).toEqual([]);
      expect(body.peopleCount).toBe(1);
      expect(body.funds.map((f: { slug: string }) => f.slug)).toEqual([slugs.fund]);
      expect(body.funds[0].status).toBeNull();
      expect(leaks(body, [S.firmHq, S.personTitle, S.fee])).toEqual([]);
    });

    it('signed in: partner people and values shown', async () => {
      const { body } = await get(`/investors/${slugs.firm}`, 'locked');
      expect(body.description).toBe(S.firmDescription);
      expect(text(body)).toContain(S.personTitle);
    });

    it('a partner-only firm is a stub signed out, indexable with a description', async () => {
      const out = await get(`/investors/${slugs.partnerFirm}`, 'signedOut');
      expect(out.body).toMatchObject({ partnerOnly: true, indexable: true, description: S.pfirmDescription, type: '', commitments: [], commitmentCount: 1 });
      expect(out.body.identifiers).toBeUndefined();
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
      expect(companies.body.items[0].masked).toEqual(['hq']);
      expect(companies.body.items[0].description).toBe(S.description);
      expect(companies.body.items[0].oneLiner).toBe(S.oneLiner);
      expect(leaks(companies.body, [S.hq, S.poDescription])).toEqual([]);

      const investors = await get(`/investors?q=${q}`, 'signedOut');
      expect(slugsOf(investors.body)).toEqual([slugs.firm]);
      expect(investors.body.items[0].description).toBe(S.firmDescription);
      expect(investors.body.items[0].masked).toEqual(['hq']);
      expect(leaks(investors.body, [S.firmHq])).toEqual([]);

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

    it('signed out: public partner prose can match the company search', async () => {
      const { body } = await get(`/companies?q=${encodeURIComponent(S.oneLiner)}`, 'signedOut');
      expect(slugsOf(body)).toEqual([slugs.publicCo]);
    });

    it('signed out: a filter never matches a partner-written value', async () => {
      const { body } = await get(`/funds?q=${q}&status=Closed`, 'signedOut');
      // The status filter is ignored outright signed out (a partner-only column).
      expect(slugsOf(body)).toEqual([slugs.fund]);
      expect(body.items[0].status).toBeNull();
    });

    it('signed in: every entity listed, with partner values', async () => {
      const companies = await get(`/companies?q=${q}`, 'locked');
      expect(slugsOf(companies.body)).toEqual([slugs.publicCo, slugs.partnerCo, slugs.partnerCoBare].sort());
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
    it('lists public companies and prose stubs, never a bare stub', async () => {
      for (const slug of [slugs.publicCo, slugs.partnerCo, slugs.partnerCoBare]) {
        const before = await prisma.company.count({
          where: {
            moderationStatus: 'APPROVED', mergedIntoId: null, slug: { lt: slug },
            OR: [{ partnerOnly: false }, { oneLiner: { not: '' } }, { description: { not: '' } }],
          },
        });
        const { body } = await get(`/companies/sitemap?page=${Math.floor(before / SITEMAP_PAGE_SIZE)}`, 'signedOut');
        expect(body.some((entry: { slug: string }) => entry.slug === slug)).toBe(slug !== slugs.partnerCoBare);
      }
    }, SITEMAP_TIMEOUT_MS);

    it('lists a partner-only firm with prose', async () => {
      const before = await prisma.investor.count({
        where: {
          moderationStatus: 'APPROVED', mergedIntoId: null, slug: { lt: slugs.partnerFirm },
          OR: [
            {
              partnerOnly: false,
              OR: [
                { holdings: { some: { moderationStatus: 'APPROVED', company: { moderationStatus: 'APPROVED', mergedIntoId: null } } } },
                { funds: { some: { moderationStatus: 'APPROVED' } } },
                { people: { some: { moderationStatus: 'APPROVED' } } },
                { commitments: { some: { moderationStatus: 'APPROVED', fund: { moderationStatus: 'APPROVED' } } } },
              ],
            },
            { AND: [{ description: { not: null } }, { NOT: { description: '' } }] },
          ],
        },
      });
      const { body } = await get(`/investors/sitemap?page=${Math.floor(before / SITEMAP_PAGE_SIZE)}`, 'signedOut');
      expect(body.some((entry: { slug: string }) => entry.slug === slugs.partnerFirm)).toBe(true);
    }, SITEMAP_TIMEOUT_MS);
  });

  describe('retracting an approved edit', () => {
    it('masks a reverted partner field again for a signed-out viewer', async () => {
      const proposal = await prisma.changeProposal.create({
        data: {
          companyId: ids.publicCo!,
          changes: { hq: `human-hq-${stamp}` },
          submittedById: ids['user-USER'],
        },
        select: { id: true },
      });
      const decide = (status: 'APPROVED' | 'REJECTED') =>
        http()
          .patch(`/admin/submissions/proposal/${proposal.id}`)
          .set('Authorization', `Bearer ${tokens.admin}`)
          .send({ status })
          .expect(200);

      // The approval replaced the partner's value with a human one: unmasked.
      await decide('APPROVED');
      const approved = await get(`/companies/${slugs.publicCo}`, 'signedOut');
      expect(approved.body.company.hq).toBe(`human-hq-${stamp}`);
      expect(approved.body.company.masked).toBeUndefined();

      // The retraction restores the partner's value — and its mark with it.
      const res = await decide('REJECTED');
      expect(res.body).toMatchObject({ revertedFields: ['hq'], skippedFields: [] });
      const out = await get(`/companies/${slugs.publicCo}`, 'signedOut');
      expect(out.body.company.masked).toEqual(['hq']);
      expect(leaks(out.body, [S.hq])).toEqual([]);
      const locked = await get(`/companies/${slugs.publicCo}`, 'locked');
      expect(locked.body.company.hq).toBe(S.hq);
    });
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
