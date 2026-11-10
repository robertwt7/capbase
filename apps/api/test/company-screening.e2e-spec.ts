import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  DEFAULT_GATE_POLICY,
  MAX_V1_LIST_DEPTH,
  resolveGatePolicy,
  type CompanyDirectoryPage,
  type GatePolicy,
  type GatePolicyOverrides,
} from '@repo/api';
import request from 'supertest';

import { ApiKeysService } from './../src/api-keys/api-keys.service';
import { AppModule } from './../src/app.module';
import { GatePolicyService } from './../src/gate/gate-policy.service';
import { PrismaService } from './../src/prisma/prisma.service';

// Company screening, end to end against real Postgres: scale ranges on recorded
// values, financing criteria that must hold for ONE round, the investor filter
// by firm identity, and the read gate deciding who may use each.
//
// Every fixture company is named `screen-<stamp>-…` and every request adds
// `q=screen-<stamp>`, so the local corpus and parallel suites never leak in.
// Policy overrides are stubbed on `GatePolicyService.current()` (never written:
// other suites read the same tables). No /auth calls: users are made with
// Prisma and JWTs signed with the app's JwtService. Cleanup deletes only ids
// this suite created, each guarded (`where: { id: undefined }` is no filter).

const DAY = 86_400_000;

describe('Company screening (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let gatePolicy: GatePolicyService;
  let current: GatePolicy = DEFAULT_GATE_POLICY;
  const stamp = Date.now();
  const prefix = `screen-${stamp}`;
  const http = () => request(app.getHttpServer());

  const ids: Record<string, string | undefined> = {};
  const slug = (k: string) => `${prefix}-${k.toLowerCase()}`;
  const tokens: Record<string, string | undefined> = {};
  let v1Key = '';
  type Viewer = 'signedOut' | 'user' | 'contributor' | 'contributor2' | 'admin';

  const monthsAgo = (n: number) => new Date(Date.now() - n * 30.5 * DAY);
  const usd = (n: number) => BigInt(n);

  const policyWith = (o: Partial<GatePolicyOverrides>): GatePolicy => {
    const { policy, dropped } = resolveGatePolicy({ sections: [], fields: [], ...o });
    expect(dropped).toEqual([]);
    return policy;
  };
  const section = (name: keyof GatePolicy['sections'], p: Record<string, unknown>) => ({
    section: name,
    ...DEFAULT_GATE_POLICY.sections[name],
    ...p,
  });

  const base = {
    domain: '',
    oneLiner: '',
    description: '',
    hq: 'Sydney',
    countryCode: 'AU',
    primarySector: 'Fintech',
    founded: 0,
    headcount: 0,
    status: 'Private',
    stage: 'Seed',
    totalRaisedUsd: usd(0),
    moderationStatus: 'APPROVED' as const,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    gatePolicy = app.get(GatePolicyService);

    const company = async (key: string, data: Record<string, unknown> = {}) => {
      ids[key] = (
        await prisma.company.create({
          data: { ...base, slug: slug(key), name: `${prefix}-${key}`, ...data },
          select: { id: true },
        })
      ).id;
    };
    const round = async (key: string, company: string, data: Record<string, unknown>) => {
      ids[key] = (
        await prisma.fundingRound.create({
          data: {
            companyId: ids[company]!,
            name: 'Series A',
            kind: 'Equity',
            moderationStatus: 'APPROVED',
            amountUsd: usd(0),
            date: new Date(),
            ...data,
          } as never,
          select: { id: true },
        })
      ).id;
    };

    await company('A', { totalRaisedUsd: usd(12_000_000), founded: 2018, headcount: 50 });
    await round('rA', 'A', { amountUsd: usd(3_000_000), date: monthsAgo(2) });

    await company('B', { totalRaisedUsd: usd(12_000_000), founded: 2010 });
    await round('rB1', 'B', { amountUsd: usd(3_000_000), date: monthsAgo(30) });
    await round('rB2', 'B', { amountUsd: usd(0), date: monthsAgo(2) });

    await company('C', { totalRaisedUsd: usd(12_000_000), lastValuationUsd: usd(100_000_000) });
    await round('rC1', 'C', { amountUsd: usd(2_000_000), date: monthsAgo(3) });
    await round('rC2', 'C', { amountUsd: usd(4_000_000), date: monthsAgo(1), name: 'Series B' });

    await company('D');
    await round('rD', 'D', { kind: 'Grant', amountUsd: usd(500_000), date: monthsAgo(2), name: 'SBIR Phase I' });

    await company('E', { lastValuationUsd: null });

    await company('F', { totalRaisedUsd: usd(2_000_000) });
    await round('rF1', 'F', { amountUsd: usd(1_000_000), date: new Date('2015-01-01T00:00:00Z') });
    await round('rF2', 'F', { amountUsd: usd(1_000_000), date: new Date('2015-12-31T00:00:00Z'), name: 'Series B' });

    await company('G', { totalRaisedUsd: usd(12_000_000), mergedIntoId: ids.A });
    await round('rG', 'G', { amountUsd: usd(3_000_000), date: monthsAgo(2) });

    await company('H');
    await round('rH', 'H', {
      amountUsd: usd(2_000_000),
      date: monthsAgo(2),
      externalSource: 'PARTNER',
      externalId: `${prefix}-rH`,
    });

    await company('I', { totalRaisedUsd: usd(12_000_000), partnerFields: ['totalRaisedUsd'] });

    await company('M');
    await round('rM1', 'M', { amountUsd: usd(1_000_000), date: new Date('2019-06-01T00:00:00Z') });
    await round('rM2', 'M', { amountUsd: usd(1_500_000), date: monthsAgo(4) });

    const firm = async (key: string, data: Record<string, unknown> = {}) => {
      ids[key] = (
        await prisma.investor.create({
          data: { slug: slug(key), name: `Namesake Capital ${stamp}`, type: 'Venture', moderationStatus: 'APPROVED', ...data },
          select: { id: true },
        })
      ).id;
    };
    await firm('J');
    await firm('K');
    await firm('L', { name: `Merged Capital ${stamp}`, mergedIntoId: ids.J });
    await firm('N', { name: `Partner Only Capital ${stamp}`, partnerOnly: true });

    const holding = (company: string, investor: string) =>
      prisma.investorHolding.create({
        data: {
          companyId: ids[company]!,
          investorId: ids[investor]!,
          name: `Namesake Capital ${stamp}`,
          type: 'Venture',
          firstRound: 'Seed',
          rounds: 1,
          moderationStatus: 'APPROVED',
        },
      });
    await holding('A', 'J');
    await holding('C', 'K');
    await holding('A', 'N');
    await prisma.roundInvestor.create({
      data: { roundId: ids.rM1!, name: `Namesake Capital ${stamp}`, investorId: ids.J! },
    });

    const jwt = app.get(JwtService);
    const user = async (key: Exclude<Viewer, 'signedOut'>, role: 'USER' | 'CONTRIBUTOR' | 'ADMIN') => {
      const row = await prisma.user.create({
        data: { email: `${prefix}-${key.toLowerCase()}@test.dev`, name: `Screen ${key}`, passwordHash: 'unused', role, emailVerifiedAt: new Date() },
        select: { id: true, email: true, tokenVersion: true },
      });
      ids[`user-${key}`] = row.id;
      tokens[key] = jwt.sign({ sub: row.id, email: row.email, role, tv: row.tokenVersion });
    };
    await user('user', 'USER');
    await user('contributor', 'CONTRIBUTOR');
    await user('contributor2', 'CONTRIBUTOR');
    await user('admin', 'ADMIN');
    v1Key = (
      await app
        .get(ApiKeysService)
        .create({ id: ids['user-contributor2']!, role: 'CONTRIBUTOR', emailVerified: true }, { name: `${prefix} key`, scope: 'contributor' })
    ).token;

    jest.spyOn(gatePolicy, 'current').mockImplementation(() => current);
  }, 60_000);

  beforeEach(() => {
    current = DEFAULT_GATE_POLICY;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    for (const key of ['user', 'contributor', 'contributor2', 'admin']) {
      const id = ids[`user-${key}`];
      if (id) await prisma.user.delete({ where: { id } });
    }
    // The merged rows first, then their survivors (rounds and holdings cascade).
    for (const key of ['G', 'A', 'B', 'C', 'D', 'E', 'F', 'H', 'I', 'M']) {
      const id = ids[key];
      if (id) await prisma.company.delete({ where: { id } });
    }
    for (const key of ['L', 'J', 'K', 'N']) {
      const id = ids[key];
      if (id) await prisma.investor.delete({ where: { id } });
    }
    await app.close();
  });

  // Spread the calls over two contributors so neither nears the 60/min list throttle.
  let turn = 0;
  const get = (path: string, viewer: Viewer, status = 200) => {
    const who = viewer === 'contributor' ? (turn++ % 2 ? 'contributor2' : 'contributor') : viewer;
    const req = http().get(path);
    const token = who === 'signedOut' ? undefined : tokens[who];
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).expect(status);
  };
  const list = async (params: string, viewer: Viewer = 'contributor'): Promise<CompanyDirectoryPage> =>
    (await get(`/companies?q=${prefix}&pageSize=100&${params}`, viewer)).body as CompanyDirectoryPage;
  const names = (page: CompanyDirectoryPage) => page.items.map((c) => c.slug.slice(prefix.length + 1).toUpperCase()).sort();
  const members = async (params: string, viewer: Viewer = 'contributor') => names(await list(params, viewer));

  /** Every page at pageSize 2: totals agree, nothing repeats. */
  const walk = async (params: string, viewer: Viewer = 'contributor') => {
    const seen: string[] = [];
    let total = -1;
    for (let page = 1; page < 20; page++) {
      const body = (await get(`/companies?q=${prefix}&pageSize=2&page=${page}&${params}`, viewer)).body as CompanyDirectoryPage;
      total = body.total;
      seen.push(...body.items.map((c) => c.slug));
      if (page * 2 >= total) break;
    }
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    return seen;
  };

  const EXAMPLE = 'country=AU&sector=Fintech&raisedMin=5000000&raisedMax=50000000&roundWithin=12m&roundKind=Equity';

  describe('the example query', () => {
    it('returns the fixture set, once each, with totals that agree across pages', async () => {
      expect(await members(EXAMPLE)).toEqual(['A', 'B', 'C']);
      expect(await walk(EXAMPLE)).toHaveLength(3);
    });

    it('carries the latest matching round per row and the resolved window', async () => {
      const page = await list(EXAMPLE);
      expect(page.screen?.matches[slug('C')]).toMatchObject({ id: ids.rC2, name: 'Series B', amountUsd: 4_000_000, kind: 'Equity' });
      expect(page.screen?.matches[slug('B')]?.id).toBe(ids.rB2);
      expect(page.screen?.window?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(page.screen?.window?.to).toBeNull();
      expect(page.screen?.investor).toBeNull();
    });

    it('/v1 returns the same companies with a contributor key, and keeps the depth limit', async () => {
      const site = await members(EXAMPLE);
      const v1 = (await http().get(`/v1/companies?q=${prefix}&pageSize=100&${EXAMPLE}`).set('Authorization', `Bearer ${v1Key}`).expect(200))
        .body as CompanyDirectoryPage;
      expect(names(v1)).toEqual(site);
      expect(v1.screen?.matches[slug('A')]?.id).toBe(ids.rA);
      const deep = MAX_V1_LIST_DEPTH / 100 + 1;
      await http().get(`/v1/companies?page=${deep}&pageSize=100&${EXAMPLE}`).set('Authorization', `Bearer ${v1Key}`).expect(400);
    });
  });

  describe('financing criteria hold for one round', () => {
    it('never matches amount on one round and date on another', async () => {
      expect(await members('roundWithin=12m')).toEqual(['A', 'B', 'C', 'D', 'H', 'M']);
      expect(await members('roundWithin=12m&roundMin=1000000')).toEqual(['A', 'C', 'H', 'M']);
    });

    it('lists a company with two matching rounds once', async () => {
      const seen = await walk('roundWithin=12m&roundKind=Equity');
      expect(seen.filter((s) => s === slug('C'))).toHaveLength(1);
      expect(seen).toHaveLength(5);
    });

    it('keeps grants and equity apart', async () => {
      expect(await members('roundKind=Grant')).toEqual(['D']);
      expect(await members('roundKind=Equity&roundWithin=12m')).toEqual(['A', 'B', 'C', 'H', 'M']);
    });

    it('treats both fixed-window ends as inclusive', async () => {
      const window = async (from: string, to?: string) => {
        const page = await list(`roundFrom=${from}${to ? `&roundTo=${to}` : ''}&roundKind=Equity`);
        return { members: names(page), date: page.screen?.matches[slug('F')]?.date };
      };
      expect(await window('2015-01-01', '2015-12-31')).toEqual({ members: ['F'], date: '2015-12-31' });
      expect(await window('2015-01-01', '2015-01-01')).toEqual({ members: ['F'], date: '2015-01-01' });
      expect(await window('2015-12-31', '2015-12-31')).toEqual({ members: ['F'], date: '2015-12-31' });
      expect(await window('2015-01-02', '2015-12-30')).toEqual({ members: [], date: undefined });
      expect((await window('2015-01-01', '2015-12-30')).date).toBe('2015-01-01');
    });

    it('never lists a merged-away company', async () => {
      const page = await list('roundWithin=12m');
      expect(page.items.map((c) => c.slug)).not.toContain(slug('G'));
    });
  });

  describe('scale ranges match recorded values only', () => {
    it('never matches an unknown figure, even with a zero or maximal bound', async () => {
      expect(await members('raisedMin=0')).toEqual(['A', 'B', 'C', 'F', 'I']);
      expect(await members('raisedMax=5000000')).toEqual(['F']);
      expect(await members('foundedMax=2100')).toEqual(['A', 'B']);
      expect(await members('foundedMin=2015')).toEqual(['A']);
      expect(await members('headcountMin=0')).toEqual(['A']);
      expect(await members('valuationMin=0')).toEqual(['C']);
    });

    it('never matches a partner-written total for a viewer who may not see it', async () => {
      expect(await members('raisedMin=5000000', 'signedOut')).toEqual(['A', 'B', 'C']);
      expect(await members('raisedMin=5000000')).toEqual(['A', 'B', 'C', 'I']);
    });
  });

  describe('investor by identity', () => {
    it('tells namesakes apart', async () => {
      expect(await members(`investor=${slug('J')}`)).toEqual(['A', 'M']);
      expect(await members(`investor=${slug('K')}`)).toEqual(['C']);
      const page = await list(`investor=${slug('J')}`);
      expect(page.screen?.investor).toEqual({ slug: slug('J'), name: `Namesake Capital ${stamp}`, scope: 'holdingsAndRounds' });
    });

    it('follows a merged firm to its survivor', async () => {
      const page = await list(`investor=${slug('L')}`);
      expect(names(page)).toEqual(['A', 'M']);
      expect(page.screen?.investor?.slug).toBe(slug('J'));
    });

    it('ties the investor to the matching financing only in `round` mode', async () => {
      expect(await members(`investor=${slug('J')}&roundWithin=12m`)).toEqual(['A', 'M']);
      expect(await members(`investor=${slug('J')}&investorOn=round&roundWithin=12m`)).toEqual([]);
      const named = await list(`investor=${slug('J')}&investorOn=round`);
      expect(names(named)).toEqual(['M']);
      expect(named.screen?.matches[slug('M')]?.id).toBe(ids.rM1);
      expect(named.screen?.investor?.scope).toBe('round');
    });

    it('answers a partner-only firm signed out exactly like an unknown slug', async () => {
      current = policyWith({ sections: [section('companyInvestors', { signedOut: 'full', signedIn: 'full' })] });
      const hidden = await list(`investor=${slug('N')}`, 'signedOut');
      const unknown = await list(`investor=does-not-exist-${stamp}`, 'signedOut');
      expect(hidden.items).toEqual([]);
      expect(hidden.total).toBe(0);
      expect(hidden.screen).toEqual(unknown.screen);
      expect(hidden.screen).toMatchObject({ investor: null, investorNotFound: true });
      // Signed in, the same firm resolves.
      expect(await members(`investor=${slug('N')}`)).toEqual(['A']);
    });
  });

  describe('the read gate', () => {
    it('ignores and reports the section-backed filters below full access', async () => {
      for (const viewer of ['signedOut', 'user'] as const) {
        const filtered = await list(`roundWithin=12m&investor=${slug('J')}&raisedMin=1`, viewer);
        const plain = await list('raisedMin=1', viewer);
        expect(filtered.locked.filters).toEqual(expect.arrayContaining(['round', 'investor']));
        expect(filtered.locked.unlockBy).toMatchObject({ round: 'contribute', investor: 'contribute' });
        expect(names(filtered)).toEqual(names(plain));
        expect(filtered.screen?.matches).toEqual({});
        expect(filtered.screen?.window).toBeNull();
      }
    });

    it('filters partner rounds out for a viewer below the partner audience', async () => {
      current = policyWith({
        sections: [section('companyRounds', { signedIn: 'full', partnerAudience: 'contributors' })],
      });
      expect(await members('roundWithin=12m', 'user')).toEqual(['A', 'B', 'C', 'D', 'M']);
      expect(await members('roundWithin=12m')).toEqual(['A', 'B', 'C', 'D', 'H', 'M']);
    });

    it('reports a filter switched off for every visitor as disabled; an admin still uses it', async () => {
      current = policyWith({
        sections: [section('companyRounds', { signedOut: 'hidden', signedIn: 'hidden', unlocked: 'hidden' })],
      });
      const page = await list('roundKind=Grant');
      expect(page.locked.disabled).toContain('round');
      expect(page.locked.filters).not.toContain('round');
      expect(names(page)).toHaveLength(10 - 1); // every fixture but the merged G
      expect(await members('roundKind=Grant', 'admin')).toEqual(['D']);
    });

    it('lets an admin bypass every lock', async () => {
      const page = await list(`roundWithin=12m&investor=${slug('J')}`, 'admin');
      expect(page.locked.filters).toEqual([]);
      expect(names(page)).toEqual(['A', 'M']);
    });
  });

  describe('invalid input', () => {
    it.each([
      'raisedMin=9&raisedMax=1',
      'foundedMin=2020&foundedMax=2000',
      'roundWithin=12m&roundFrom=2015-01-01',
      'roundFrom=2026-02-30',
      'roundFrom=2015-12-31&roundTo=2015-01-01',
      'investorOn=round',
      'roundKind=Loan',
      'raisedMin=-1',
      'roundWithin=7m',
      'headcountMax=12.5',
    ])('answers 400 for %s without echoing a fixture value', async (params) => {
      const res = await get(`/companies?q=${prefix}&${params}`, 'contributor', 400);
      expect(JSON.stringify(res.body)).not.toContain(String(stamp));
    });
  });

  describe('existing behaviour', () => {
    it('keeps the compare path exact and an unscreened page free of screen context', async () => {
      const page = (await get(`/companies?slugs=${slug('A')},${slug('C')}`, 'signedOut')).body as CompanyDirectoryPage;
      expect(names(page)).toEqual(['A', 'C']);
      expect(page.screen).toBeNull();
      expect(page.locked.disabled).toEqual([]);
    });
  });
});
