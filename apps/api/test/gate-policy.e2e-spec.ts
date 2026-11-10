import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  DEFAULT_GATE_POLICY,
  resolveGatePolicy,
  type GatePolicy,
  type GatePolicyOverrides,
} from '@repo/api';
import request from 'supertest';

import { ApiKeysService } from './../src/api-keys/api-keys.service';
import { AppModule } from './../src/app.module';
import { GatePolicyService, WINDOW_SETTING } from './../src/gate/gate-policy.service';
import { PrismaService } from './../src/prisma/prisma.service';

// The configurable read gate, end to end: each kind of setting is overridden
// and the sentinel rows and values must appear for exactly the tiers it allows.
//
// Read-path cases stub `GatePolicyService.current()` with a policy resolved
// from override rows by the real `resolveGatePolicy` — never written to the
// shared database, because e2e suites run in parallel and every other suite's
// app reads the same policy tables (a `companyRounds` row here would flip
// `gate.e2e-spec`'s assertions). The admin-API cases do write rows, through
// the routes, only for a section and a field no other suite asserts on
// (`companyExits`, `company.twitterUrl`), and remove them at once; `afterAll`
// deletes anything left and reloads.
//
// No /auth calls (throttled): users are created with Prisma and their JWTs
// signed with the app's JwtService. Cleanup deletes only ids this suite
// created, each guarded.

describe('Configurable read gate (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let gatePolicy: GatePolicyService;
  let current: GatePolicy = DEFAULT_GATE_POLICY;
  let stub: { mockRestore: () => void } | undefined;
  const stamp = Date.now();
  const tag = `e2e-policy-${stamp}`;
  const http = () => request(app.getHttpServer());

  const S = {
    description: `policy-partner-description-${stamp}`,
    partnerRound: `policy-partner-round-${stamp}`,
    partnerHolding: `policy-partner-holding-${stamp}`,
    raisedA: 111_222_333,
    raisedB: 999_888_777,
    fee: 1.61803,
    twitter: `https://twitter.com/policy${stamp}`,
  };
  const slugs = { a: `${tag}-a`, b: `${tag}-b`, firm: `${tag}-firm`, fund: `${tag}-fund` };
  const names = { a: `Policy Alpha ${stamp}`, b: `Policy Beta ${stamp}` };
  const ids: Record<string, string | undefined> = {};
  const tokens: Record<'locked' | 'unlockedUser' | 'staleUser' | 'contributor' | 'admin', string | undefined> = {
    locked: undefined,
    unlockedUser: undefined,
    staleUser: undefined,
    contributor: undefined,
    admin: undefined,
  };
  type Viewer = 'signedOut' | keyof typeof tokens;

  /** A policy from override rows, through the same resolver the service uses. */
  const policyWith = (o: Partial<GatePolicyOverrides>): GatePolicy => {
    const { policy, dropped } = resolveGatePolicy({ sections: [], fields: [], ...o });
    expect(dropped).toEqual([]);
    return policy;
  };
  const section = (name: string, p: Record<string, unknown>) => ({
    section: name,
    ...DEFAULT_GATE_POLICY.sections[name as keyof GatePolicy['sections']],
    ...p,
  });
  const field = (entity: string, name: string, audience: string, partnerAudience: string) => ({
    entity,
    field: name,
    audience,
    partnerAudience,
  });

  const base = {
    domain: '',
    oneLiner: '',
    description: '',
    hq: 'Undisclosed',
    founded: 0,
    headcount: 0,
    status: 'Private',
    moderationStatus: 'APPROVED' as const,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    gatePolicy = app.get(GatePolicyService);

    ids.a = (
      await prisma.company.create({
        data: {
          ...base,
          slug: slugs.a,
          name: names.a,
          stage: 'Seed',
          totalRaisedUsd: BigInt(S.raisedA),
          description: S.description,
          twitterUrl: S.twitter,
          partnerFields: ['description'],
          externalSource: 'SEC_EDGAR',
          externalId: `${tag}-a`,
        },
        select: { id: true },
      })
    ).id;
    ids.b = (
      await prisma.company.create({
        data: {
          ...base,
          slug: slugs.b,
          name: names.b,
          stage: 'Series A',
          totalRaisedUsd: BigInt(S.raisedB),
          externalSource: 'SEC_EDGAR',
          externalId: `${tag}-b`,
        },
        select: { id: true },
      })
    ).id;
    const round = (n: number, data: Record<string, unknown>) =>
      prisma.fundingRound.create({
        data: {
          companyId: ids.a!,
          name: `Round ${n}`,
          date: new Date(`2020-0${n}-01`),
          amountUsd: 1_000_000n,
          moderationStatus: 'APPROVED',
          externalId: `${tag}-r${n}`,
          ...data,
        },
        select: { id: true },
      });
    ids.r1 = (await round(1, { externalSource: 'SEC_EDGAR' })).id;
    ids.r2 = (await round(2, { name: S.partnerRound, externalSource: 'PARTNER' })).id;
    ids.r3 = (await round(3, { externalSource: 'SEC_EDGAR' })).id;
    await prisma.personRole.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        companyId: ids.a!,
        name: `Officer ${i + 1}`,
        role: 'Director',
        since: 2010 + i,
        externalSource: 'SEC_EDGAR',
        externalId: `${tag}-role-${i}`,
        moderationStatus: 'APPROVED' as const,
      })),
    });
    await prisma.investorHolding.createMany({
      data: [
        { companyId: ids.a!, name: 'Holder One', type: 'Venture', firstRound: 'Seed', rounds: 2, externalSource: 'WIKIDATA', externalId: `${tag}-h1`, moderationStatus: 'APPROVED' },
        { companyId: ids.a!, name: 'Holder Two', type: 'Venture', firstRound: 'Seed', rounds: 1, externalSource: 'WIKIDATA', externalId: `${tag}-h2`, moderationStatus: 'APPROVED' },
        { companyId: ids.a!, name: S.partnerHolding, type: 'Venture', firstRound: 'Seed', rounds: 3, externalSource: 'PARTNER', externalId: `${tag}-h3`, moderationStatus: 'APPROVED' },
      ],
    });
    await prisma.diversitySignal.create({
      data: { companyId: ids.a!, label: 'Founders', value: 'Mixed', note: '', moderationStatus: 'APPROVED' },
    });
    await prisma.exitEvent.create({
      data: { companyId: ids.a!, type: 'IPO', date: new Date('2024-01-01'), detail: 'Listed', moderationStatus: 'APPROVED' },
    });

    ids.firm = (
      await prisma.investor.create({
        data: { slug: slugs.firm, name: `Policy Firm ${stamp}`, type: 'Venture', moderationStatus: 'APPROVED', externalSource: 'SEC_ADV', externalId: `${tag}-firm` },
        select: { id: true },
      })
    ).id;
    ids.fund = (
      await prisma.fund.create({
        data: {
          slug: slugs.fund,
          name: `Policy Fund ${stamp}`,
          managerId: ids.firm,
          managementFeePct: S.fee,
          moderationStatus: 'APPROVED',
          externalSource: 'SEC_ADV_FUNDS',
          externalId: `${tag}-fund`,
        },
        select: { id: true },
      })
    ).id;

    const jwt = app.get(JwtService);
    const user = async (key: keyof typeof tokens, role: 'USER' | 'CONTRIBUTOR' | 'ADMIN') => {
      const row = await prisma.user.create({
        data: { email: `${tag}-${key.toLowerCase()}@test.dev`, name: `Policy ${key}`, passwordHash: 'unused', role, emailVerifiedAt: new Date() },
        select: { id: true, email: true, tokenVersion: true },
      });
      ids[`user-${key}`] = row.id;
      tokens[key] = jwt.sign({ sub: row.id, email: row.email, role, tv: row.tokenVersion });
    };
    await user('locked', 'USER');
    await user('unlockedUser', 'USER');
    await user('staleUser', 'USER');
    await user('contributor', 'CONTRIBUTOR');
    await user('admin', 'ADMIN');
    const contribution = (userKey: string, createdAt: Date) =>
      prisma.changeProposal.create({
        data: { companyId: ids.b!, submittedById: ids[`user-${userKey}`]!, changes: { hq: 'London' }, moderationStatus: 'APPROVED', createdAt },
      });
    await contribution('unlockedUser', new Date());
    await contribution('staleUser', new Date(Date.now() - 2 * 86_400_000));

    stub = jest.spyOn(gatePolicy, 'current').mockImplementation(() => current);
  }, 60_000);

  beforeEach(() => {
    current = DEFAULT_GATE_POLICY;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    // Only rows this suite's admin cases could have written.
    await prisma.gateSectionPolicy.deleteMany({ where: { section: 'companyExits', updatedById: ids['user-admin'] ?? '' } });
    await prisma.gateFieldPolicy.deleteMany({
      where: { entity: 'company', field: 'twitterUrl', updatedById: ids['user-admin'] ?? '' },
    });
    await prisma.siteSetting.deleteMany({ where: { key: WINDOW_SETTING, updatedById: ids['user-admin'] ?? '' } });
    await gatePolicy.reload();
    for (const key of Object.keys(tokens)) {
      const id = ids[`user-${key}`];
      if (id) {
        await prisma.changeProposal.deleteMany({ where: { submittedById: id } });
        await prisma.user.delete({ where: { id } });
      }
    }
    if (ids.fund) await prisma.fund.delete({ where: { id: ids.fund } });
    if (ids.firm) await prisma.investor.delete({ where: { id: ids.firm } });
    if (ids.a) await prisma.company.delete({ where: { id: ids.a } });
    if (ids.b) await prisma.company.delete({ where: { id: ids.b } });
    await app.close();
  });

  const get = (path: string, viewer: Viewer, status = 200) => {
    const req = http().get(path);
    const token = viewer === 'signedOut' ? undefined : tokens[viewer];
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).expect(status);
  };
  const text = (body: unknown) => JSON.stringify(body);
  const profile = async (viewer: Viewer) => (await get(`/companies/${slugs.a}`, viewer)).body;

  describe('sections', () => {
    it('companyRounds full signed out: every public round, partner rounds still filtered', async () => {
      current = policyWith({ sections: [section('companyRounds', { signedOut: 'full', signedIn: 'full' })] });
      const body = await profile('signedOut');
      expect(body.company.rounds.map((r: { id: string }) => r.id)).toEqual([ids.r1, ids.r3]);
      expect(text(body)).not.toContain(S.partnerRound);
      expect(body.gate.sections.companyRounds).toEqual({ disabled: false, unlockBy: 'signIn', adminOnly: false });
    });

    it('…and with partnerAudience everyone, the partner rounds too', async () => {
      current = policyWith({
        sections: [section('companyRounds', { signedOut: 'full', signedIn: 'full', partnerAudience: 'everyone' })],
      });
      const body = await profile('signedOut');
      expect(body.company.rounds.map((r: { id: string }) => r.id)).toEqual([ids.r1, ids.r2, ids.r3]);
      expect(body.gate.sections.companyRounds.unlockBy).toBeNull();
    });

    it('companyInvestors hidden / hidden / full: contribute to see any', async () => {
      current = policyWith({ sections: [section('companyInvestors', { signedOut: 'hidden', signedIn: 'hidden' })] });
      for (const viewer of ['signedOut', 'locked'] as const) {
        const body = await profile(viewer);
        expect(body.company.investors).toEqual([]);
        expect(body.access.totals.investors).toBe(3);
        expect(body.gate.sections.companyInvestors.unlockBy).toBe('contribute');
        expect(text(body)).not.toContain('Holder One');
      }
      const all = await profile('contributor');
      expect(all.company.investors).toHaveLength(3);
      expect(all.gate.sections.companyInvestors.unlockBy).toBeNull();
    });

    it('companyDiversity switched off: nothing for a contributor, everything for an admin', async () => {
      current = policyWith({
        sections: [section('companyDiversity', { signedOut: 'hidden', signedIn: 'hidden', unlocked: 'hidden' })],
      });
      const contributor = await profile('contributor');
      expect(contributor.company.diversity).toEqual([]);
      expect(contributor.gate.sections.companyDiversity).toEqual({ disabled: true, unlockBy: null, adminOnly: false });
      const admin = await profile('admin');
      expect(admin.company.diversity).toHaveLength(1);
      expect(admin.gate.sections.companyDiversity).toEqual({ disabled: false, unlockBy: null, adminOnly: true });
    });

    it('companyRounds switched off nulls the summary line', async () => {
      current = policyWith({
        sections: [section('companyRounds', { signedOut: 'hidden', signedIn: 'hidden', unlocked: 'hidden' })],
      });
      const body = await profile('locked');
      expect(body.latestRound).toBeNull();
      expect(body.company.rounds).toEqual([]);
      expect((await profile('admin')).latestRound).toEqual({ stage: 'Round 3', date: '2020-03-01' });
    });

    it('previewRows 5: a locked user gets five', async () => {
      current = policyWith({ sections: [section('companyPeople', { previewRows: 5 })] });
      expect((await profile('locked')).company.people).toHaveLength(5);
      expect((await profile('signedOut')).company.people).toHaveLength(5);
      expect((await profile('contributor')).company.people).toHaveLength(6);
    });

    it('fundTerms full once signed in: a locked user gets the terms', async () => {
      const path = `/funds/${slugs.fund}`;
      expect((await get(path, 'locked')).body.fund.managementFeePct).toBeNull();
      current = policyWith({ sections: [section('fundTerms', { signedIn: 'full' })] });
      const locked = (await get(path, 'locked')).body;
      expect(locked.fund.managementFeePct).toBe(S.fee);
      expect(locked.termsHidden).toBe(false);
      const out = (await get(path, 'signedOut')).body;
      expect(out.fund.managementFeePct).toBeNull();
      expect(out.termsHidden).toBe(true);
      expect(out.gate.sections.fundTerms.unlockBy).toBe('signIn');
    });
  });

  describe('fields', () => {
    const q = encodeURIComponent(String(stamp));

    it('totalRaisedUsd for the signed in: masked signed out on the profile and the directory, sort locked', async () => {
      current = policyWith({ fields: [field('company', 'totalRaisedUsd', 'signedIn', 'signedIn')] });
      const out = await profile('signedOut');
      expect(out.company.totalRaisedUsd).toBe(0);
      expect(out.company.masked).toContain('totalRaisedUsd');
      expect(out.company.maskedUnlock.totalRaisedUsd).toBe('signIn');
      expect(text(out)).not.toContain(String(S.raisedA));

      const list = (await get(`/companies?q=${q}&sort=raised`, 'signedOut')).body;
      expect(list.locked.sorts).toEqual(['raised']);
      expect(list.items.map((c: { slug: string }) => c.slug)).toEqual([slugs.a, slugs.b]);
      expect(list.items[1].maskedUnlock.totalRaisedUsd).toBe('signIn');
      expect(text(list)).not.toContain(String(S.raisedB));

      const search = (await get(`/search?q=${q}`, 'signedOut')).body;
      expect(text(search)).not.toContain(String(S.raisedA));

      const signedIn = (await get(`/companies?q=${q}&sort=raised`, 'locked')).body;
      expect(signedIn.locked.sorts).toEqual([]);
      expect(signedIn.items.map((c: { slug: string }) => c.slug)).toEqual([slugs.b, slugs.a]);
      expect((await profile('locked')).company.totalRaisedUsd).toBe(S.raisedA);
    });

    it('stage for contributors: the filter is ignored for a locked user, applied once they contributed', async () => {
      current = policyWith({ fields: [field('company', 'stage', 'contributors', 'contributors')] });
      const locked = (await get(`/companies?q=${q}&stage=Seed`, 'locked')).body;
      // The section-backed screening filters (round, investor) need full section access too.
      expect(locked.locked.filters).toEqual(['stage', 'round', 'investor']);
      expect(locked.locked.unlockBy.stage).toBe('contribute');
      expect(locked.items.map((c: { slug: string }) => c.slug).sort()).toEqual([slugs.a, slugs.b].sort());
      expect(locked.items[0].stage).toBe('');

      const unlocked = (await get(`/companies?q=${q}&stage=Seed`, 'unlockedUser')).body;
      expect(unlocked.locked.filters).toEqual([]);
      expect(unlocked.items.map((c: { slug: string }) => c.slug)).toEqual([slugs.a]);
      expect(unlocked.items[0].stage).toBe('Seed');
    });

    it('defaults: nothing locked and the partner description public', async () => {
      const list = (await get(`/companies?q=${q}&stage=Seed`, 'signedOut')).body;
      // Only the section-backed screening filters, which default to contributors.
      expect(list.locked).toEqual({
        filters: ['round', 'investor'],
        sorts: [],
        unlockBy: { round: 'contribute', investor: 'contribute' },
        disabled: [],
      });
      expect(list.items.map((c: { slug: string }) => c.slug)).toEqual([slugs.a]);
      expect((await profile('signedOut')).company.description).toBe(S.description);
    });

    it('description with partnerAudience signedIn: the partner prose is masked signed out again', async () => {
      current = policyWith({ fields: [field('company', 'description', 'everyone', 'signedIn')] });
      const out = await profile('signedOut');
      expect(out.company.description).toBe('');
      expect(out.company.maskedUnlock.description).toBe('signIn');
      expect(text(out)).not.toContain(S.description);
      expect((await profile('locked')).company.description).toBe(S.description);
    });
  });

  describe('contribution window', () => {
    it('one day: a two-day-old contribution no longer unlocks, and the expiry is reported', async () => {
      expect((await profile('staleUser')).access).toMatchObject({ unlocked: true, windowDays: 30 });
      current = policyWith({ contributionWindowDays: 1 });
      const { access } = await profile('staleUser');
      expect(access).toMatchObject({ unlocked: false, signedIn: true, windowDays: 1 });
      expect(new Date(access.unlockedUntil).getTime()).toBeLessThan(Date.now());
    });
  });

  describe('/v1', () => {
    it('a contributor key follows the unlocked tier: no diversity when it is switched off', async () => {
      current = policyWith({
        sections: [section('companyDiversity', { signedOut: 'hidden', signedIn: 'hidden', unlocked: 'hidden' })],
      });
      const key = (
        await app.get(ApiKeysService).create(
          { id: ids['user-contributor']!, role: 'CONTRIBUTOR', emailVerified: true },
          { name: tag, scope: 'contributor' },
        )
      ).token;
      const { body } = await http().get(`/v1/companies/${slugs.a}`).set('Authorization', `Bearer ${key}`).expect(200);
      expect(body.company.diversity).toEqual([]);
      expect(body.company.rounds).toHaveLength(3);
    });
  });

  describe('admin API', () => {
    // These go through the real policy: stop stubbing it (last block).
    beforeAll(() => stub?.mockRestore());
    const admin = () => ({ Authorization: `Bearer ${tokens.admin}` });
    const exitsPolicy = { signedOut: 'full', signedIn: 'full', unlocked: 'full', previewRows: 2, partnerAudience: 'signedIn' };

    it('is ADMIN only', async () => {
      await http().get('/admin/visibility').expect(401);
      await http().get('/admin/visibility').set('Authorization', `Bearer ${tokens.locked}`).expect(403);
      await http().put('/admin/visibility/sections/companyExits').set('Authorization', `Bearer ${tokens.contributor}`).send(exitsPolicy).expect(403);
    });

    it('rejects a decreasing policy, a preview block and unknown keys', async () => {
      const bad = (path: string, body: object, status: number) =>
        http().put(path).set(admin()).send(body).expect(status);
      const decreasing = await bad('/admin/visibility/sections/companyExits', { ...exitsPolicy, signedIn: 'preview' }, 400);
      expect(decreasing.body.message).toMatch(/less/);
      await bad('/admin/visibility/sections/fundTerms', { ...exitsPolicy, signedOut: 'hidden', signedIn: 'preview' }, 400);
      await bad('/admin/visibility/sections/nope', exitsPolicy, 404);
      await bad('/admin/visibility/sections/companyExits', { ...exitsPolicy, previewRows: 99 }, 400);
      await bad('/admin/visibility/fields/company/twitterUrl', { audience: 'signedIn', partnerAudience: 'everyone' }, 400);
      await bad('/admin/visibility/fields/company/name', { audience: 'signedIn', partnerAudience: 'signedIn' }, 404);
      await bad('/admin/visibility/settings/contribution-window', { days: 0 }, 400);
      expect(await prisma.gateSectionPolicy.count({ where: { section: { in: ['companyExits', 'fundTerms'] } } })).toBe(0);
    });

    it('a section write takes effect on the next read, and a reset restores the default', async () => {
      expect((await profile('signedOut')).company.exits).toEqual([]);
      try {
        const set = await http().put('/admin/visibility/sections/companyExits').set(admin()).send(exitsPolicy).expect(200);
        const row = set.body.sections.find((s: { section: string }) => s.section === 'companyExits');
        expect(row.current).toEqual(exitsPolicy);
        expect(row.override.updatedBy).toBe(`${tag}-admin@test.dev`);
        expect((await profile('signedOut')).company.exits).toHaveLength(1);

        const view = await http().get('/admin/visibility').set(admin()).expect(200);
        expect(view.body.sections.find((s: { section: string }) => s.section === 'companyExits').override.updatedBy).toBe(
          `${tag}-admin@test.dev`,
        );
      } finally {
        await http().delete('/admin/visibility/sections/companyExits').set(admin()).expect(200);
      }
      expect((await profile('signedOut')).company.exits).toEqual([]);
      const reset = await http().get('/admin/visibility').set(admin()).expect(200);
      expect(reset.body.sections.find((s: { section: string }) => s.section === 'companyExits').override).toBeNull();
    });

    it('a field write and the window write take effect at once', async () => {
      try {
        await http()
          .put('/admin/visibility/fields/company/twitterUrl')
          .set(admin())
          .send({ audience: 'contributors', partnerAudience: 'contributors' })
          .expect(200);
        const out = await profile('locked');
        expect(out.company.twitterUrl).toBeNull();
        expect(out.company.maskedUnlock.twitterUrl).toBe('contribute');
        expect((await profile('contributor')).company.twitterUrl).toBe(S.twitter);

        const win = await http().put('/admin/visibility/settings/contribution-window').set(admin()).send({ days: 7 }).expect(200);
        expect(win.body.contributionWindowDays).toMatchObject({ default: 30, current: 7 });
        expect((await profile('locked')).access.windowDays).toBe(7);
      } finally {
        await http().delete('/admin/visibility/fields/company/twitterUrl').set(admin()).expect(200);
        await http().delete('/admin/visibility/settings/contribution-window').set(admin()).expect(200);
      }
      expect((await profile('locked')).company.twitterUrl).toBe(S.twitter);
      expect((await profile('locked')).access.windowDays).toBe(30);
    });
  });
});
