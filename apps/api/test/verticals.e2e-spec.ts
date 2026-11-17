import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  DEFAULT_GATE_POLICY,
  VERTICAL_PAGE_MIN_COMPANIES,
  VERTICALS,
  labelSlug,
  resolveGatePolicy,
  type CompanyDetailResponse,
  type CompanyDirectoryPage,
  type GatePolicy,
  type GatePolicyOverrides,
  type VerticalMarketResponse,
  type VerticalStat,
} from '@repo/api';
import request from 'supertest';

import { ApiKeysService } from './../src/api-keys/api-keys.service';
import { AppModule } from './../src/app.module';
import { GatePolicyService } from './../src/gate/gate-policy.service';
import { MarketService } from './../src/market/market.service';
import { PrismaService } from './../src/prisma/prisma.service';

// Verticals, end to end against real Postgres: the vertical market page reconciles with its
// fixtures for each tier, the profile fact and its provenance, the `?vertical=` filter, the
// policy lock, an edit proposal approved and retracted, the page threshold and the sitemap.
//
// The dev DB holds real companies, so every aggregate assertion is a DELTA around the fixture
// inserts. Fixture companies are named `verticals-<stamp>-…` (list requests add that `q`);
// fillers that lift a thin vertical over the page minimum are `vfill-<stamp>-…` and never match
// it. Policy overrides are stubbed on `GatePolicyService.current()` (never written: other
// suites read the same tables). No /auth calls: users are made with Prisma and JWTs signed
// with the app's JwtService. Cleanup deletes only ids this suite created, each guarded.

const VERTICAL = 'Defence';
const SLUG = labelSlug(VERTICAL);
const T = 1_000_000_000_000; // fixture totals in trillions, so they lead any stage preview

describe('Verticals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let market: MarketService;
  let current: GatePolicy = DEFAULT_GATE_POLICY;
  const stamp = Date.now();
  const prefix = `verticals-${stamp}`;
  const http = () => request(app.getHttpServer());

  const ids: Record<string, string | undefined> = {};
  const fillers: string[] = [];
  const slug = (k: string) => `${prefix}-${k.toLowerCase()}`;
  const tokens: Record<string, string | undefined> = {};
  let v1Key = '';
  type Viewer = 'signedOut' | 'contributor' | 'admin';

  const policyWith = (o: Partial<GatePolicyOverrides>): GatePolicy => {
    const { policy, dropped } = resolveGatePolicy({ sections: [], fields: [], ...o });
    expect(dropped).toEqual([]);
    return policy;
  };

  const get = (path: string, viewer: Viewer, status = 200) => {
    const req = http().get(path);
    const token = viewer === 'signedOut' ? undefined : tokens[viewer];
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).expect(status);
  };
  const stats = async (): Promise<VerticalStat[]> => {
    market.resetCache();
    return (await get('/market/verticals', 'signedOut')).body as VerticalStat[];
  };
  const page = async (viewer: Viewer): Promise<VerticalMarketResponse> =>
    (await get(`/market/verticals/${SLUG}`, viewer)).body as VerticalMarketResponse;
  const stage = (r: VerticalMarketResponse, s: string) =>
    r.visible.stages.find((g) => g.stage === s) ?? {
      companyCount: 0,
      totalRaisedUsd: 0,
      companies: [],
    };
  const names = (p: CompanyDirectoryPage) =>
    p.items.map((c) => c.slug.slice(prefix.length + 1).toUpperCase()).sort();
  const profile = async (key: string, viewer: Viewer) =>
    (await get(`/companies/${slug(key)}`, viewer)).body as CompanyDetailResponse;

  const before: Partial<Record<'signedOut' | 'contributor', VerticalMarketResponse>> = {};
  let statBefore: VerticalStat | undefined;

  const base = {
    domain: '',
    oneLiner: '',
    description: '',
    hq: 'Oslo',
    founded: 0,
    headcount: 0,
    status: 'Private',
    moderationStatus: 'APPROVED' as const,
    industry: ['Manufacture of weapons and ammunition'],
    verticals: [VERTICAL],
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    market = app.get(MarketService);
    jest.spyOn(app.get(GatePolicyService), 'current').mockImplementation(() => current);

    const jwt = app.get(JwtService);
    const user = async (key: Exclude<Viewer, 'signedOut'>, role: 'CONTRIBUTOR' | 'ADMIN') => {
      const row = await prisma.user.create({
        data: {
          email: `${prefix}-${key}@test.dev`,
          name: `Verticals ${key}`,
          passwordHash: 'unused',
          role,
          emailVerifiedAt: new Date(),
        },
        select: { id: true, email: true, tokenVersion: true },
      });
      ids[`user-${key}`] = row.id;
      tokens[key] = jwt.sign({ sub: row.id, email: row.email, role, tv: row.tokenVersion });
    };
    await user('contributor', 'CONTRIBUTOR');
    await user('admin', 'ADMIN');
    v1Key = (
      await app
        .get(ApiKeysService)
        .create(
          { id: ids['user-contributor']!, role: 'CONTRIBUTOR', emailVerified: true },
          { name: `${prefix} key`, scope: 'contributor' },
        )
    ).token;

    // A thin vertical (a local dev DB) gets public fillers so its page exists before the
    // baseline is read; the deltas below are measured after them.
    const existing = (await stats()).find((s) => s.vertical === VERTICAL)?.companyCount ?? 0;
    for (let n = 0; n < VERTICAL_PAGE_MIN_COMPANIES - existing; n++) {
      const row = await prisma.company.create({
        data: {
          ...base,
          slug: `vfill-${stamp}-${n}`,
          name: `vfill-${stamp}-${n}`,
          stage: 'Late stage',
          totalRaisedUsd: 0n,
        },
        select: { id: true },
      });
      fillers.push(row.id);
    }
    statBefore = (await stats()).find((s) => s.vertical === VERTICAL);
    before.signedOut = await page('signedOut');
    before.contributor = await page('contributor');

    const company = async (key: string, data: Record<string, unknown>) => {
      ids[key] = (
        await prisma.company.create({
          data: { ...base, slug: slug(key), name: `${prefix}-${key}`, ...data },
          select: { id: true },
        })
      ).id;
    };
    await company('A', { stage: 'Seed', totalRaisedUsd: BigInt(1 * T) });
    await company('B', { stage: 'Seed', totalRaisedUsd: BigInt(2 * T) });
    await company('C', { stage: 'Series A', totalRaisedUsd: BigInt(5 * T) });
    // Partner-derived verticals and a partner total.
    await company('D', {
      stage: 'Series A',
      totalRaisedUsd: BigInt(7 * T),
      industry: ['Defence'],
      partnerFields: ['industry', 'verticals', 'totalRaisedUsd'],
    });
    // Partner-only.
    await company('E', {
      stage: 'Series A',
      totalRaisedUsd: BigInt(3 * T),
      industry: ['Defence'],
      partnerOnly: true,
      partnerFields: ['industry', 'verticals', 'totalRaisedUsd'],
    });
    // Never counted: pending, and merged.
    await company('F', {
      stage: 'Seed',
      totalRaisedUsd: BigInt(9 * T),
      moderationStatus: 'PENDING',
    });
    await company('G', { stage: 'Seed', totalRaisedUsd: BigInt(9 * T), mergedIntoId: ids.A });
    market.resetCache();
  }, 60_000);

  beforeEach(() => {
    current = DEFAULT_GATE_POLICY;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    for (const key of ['contributor', 'admin']) {
      const id = ids[`user-${key}`];
      if (id) await prisma.user.delete({ where: { id } });
    }
    // The merged row first; proposals and revisions cascade with their company.
    for (const key of ['G', 'A', 'B', 'C', 'D', 'E', 'F']) {
      const id = ids[key];
      if (id) await prisma.company.delete({ where: { id } });
    }
    if (fillers.length > 0) await prisma.company.deleteMany({ where: { id: { in: fillers } } });
    await app.close();
  });

  describe('the vertical market page reconciles with its fixtures', () => {
    it('a contributor sees A–E, partner values included', async () => {
      const after = await page('contributor');
      const was = before.contributor!;
      expect(after.visible.companyCount - was.visible.companyCount).toBe(5);
      expect(stage(after, 'Seed').companyCount - stage(was, 'Seed').companyCount).toBe(2);
      expect(stage(after, 'Seed').totalRaisedUsd! - stage(was, 'Seed').totalRaisedUsd!).toBe(3 * T);
      expect(stage(after, 'Series A').companyCount - stage(was, 'Series A').companyCount).toBe(3);
      expect(
        stage(after, 'Series A').totalRaisedUsd! - stage(was, 'Series A').totalRaisedUsd!,
      ).toBe(15 * T);
      expect(after.visible.totalRaisedUsd! - was.visible.totalRaisedUsd!).toBe(18 * T);
      expect(after.unlockBy).toBeNull();

      const shown = new Map(
        after.visible.stages.flatMap((g) => g.companies).map((c) => [c.slug, c.totalRaisedUsd]),
      );
      expect(shown.get(slug('A'))).toBe(1 * T);
      expect(shown.get(slug('D'))).toBe(7 * T);
      expect(shown.get(slug('E'))).toBe(3 * T);
      expect(shown.has(slug('F'))).toBe(false);
      expect(shown.has(slug('G'))).toBe(false);
    });

    it('signed out sees A–C only: D is partner-derived, E partner-only', async () => {
      const after = await page('signedOut');
      const was = before.signedOut!;
      expect(after.visible.companyCount - was.visible.companyCount).toBe(3);
      expect(stage(after, 'Seed').companyCount - stage(was, 'Seed').companyCount).toBe(2);
      expect(stage(after, 'Seed').totalRaisedUsd! - stage(was, 'Seed').totalRaisedUsd!).toBe(3 * T);
      expect(stage(after, 'Series A').companyCount - stage(was, 'Series A').companyCount).toBe(1);
      expect(
        stage(after, 'Series A').totalRaisedUsd! - stage(was, 'Series A').totalRaisedUsd!,
      ).toBe(5 * T);

      const shown = after.visible.stages.flatMap((g) => g.companies).map((c) => c.slug);
      expect(shown).toEqual(expect.arrayContaining([slug('A'), slug('B'), slug('C')]));
      expect(shown).not.toContain(slug('D'));
      expect(shown).not.toContain(slug('E'));
    });

    it('the public stat counts every member, and public ones apart', async () => {
      const stat = (await stats()).find((s) => s.vertical === VERTICAL)!;
      expect(stat.companyCount - statBefore!.companyCount).toBe(5);
      expect(stat.publicCompanyCount - statBefore!.publicCompanyCount).toBe(3);
      expect(stat).toMatchObject({ sector: 'Industrials', sectorSlug: 'industrials', slug: SLUG });
      expect((await page('signedOut')).stat).toEqual(stat);
      expect((await page('contributor')).stat).toEqual(stat);
    });
  });

  describe('the profile fact', () => {
    it('masks partner-derived verticals signed out, and reports their source to a contributor', async () => {
      const out = await profile('D', 'signedOut');
      expect(out.company.verticals).toEqual([]);
      expect(out.company.masked).toContain('verticals');
      expect(out.company.maskedUnlock?.verticals).toBe('signIn');
      expect(out.verticalSources).toEqual([]);

      const contributor = await profile('D', 'contributor');
      expect(contributor.company.verticals).toEqual([VERTICAL]);
      expect(contributor.verticalSources).toEqual([
        { vertical: VERTICAL, scheme: 'partner', label: 'Defence' },
      ]);
    });

    it('a SIC-derived vertical reports its scheme and code', async () => {
      const out = await profile('A', 'signedOut');
      expect(out.company.verticals).toEqual([VERTICAL]);
      expect(out.verticalSources[0]).toEqual({
        vertical: VERTICAL,
        scheme: 'sic',
        label: 'Manufacture of weapons and ammunition',
        code: '25400',
      });
    });
  });

  describe('the directory filter', () => {
    it('rejects a value outside the vocabulary, on the site and /v1', async () => {
      await get('/companies?vertical=Nope', 'signedOut', 400);
      await http()
        .get('/v1/companies?vertical=Nope')
        .set('Authorization', `Bearer ${v1Key}`)
        .expect(400);
    });

    it('signed out matches public members only; a contributor every member', async () => {
      const q = `/companies?q=${prefix}&vertical=${encodeURIComponent(VERTICAL)}&pageSize=100`;
      expect(names((await get(q, 'signedOut')).body)).toEqual(['A', 'B', 'C']);
      expect(names((await get(q, 'contributor')).body)).toEqual(['A', 'B', 'C', 'D', 'E']);
      const v1 = await http().get(`/v1${q}`).set('Authorization', `Bearer ${v1Key}`).expect(200);
      expect(names(v1.body)).toEqual(['A', 'B', 'C', 'D', 'E']);
    });
  });

  describe('the policy', () => {
    it('a hidden verticals field locks the filter and empties the page', async () => {
      current = policyWith({
        fields: [
          {
            entity: 'company',
            field: 'verticals',
            audience: 'signedIn',
            partnerAudience: 'signedIn',
          },
        ],
      });
      const list = (
        await get(`/companies?q=${prefix}&vertical=${VERTICAL}&pageSize=100`, 'signedOut')
      ).body as CompanyDirectoryPage;
      expect(list.locked.filters).toContain('vertical');
      // Ignored, not applied: every q row a signed-out viewer may list (E is partner-only).
      expect(names(list)).toEqual(['A', 'B', 'C', 'D']);

      const out = await page('signedOut');
      expect(out.visible).toEqual({
        companyCount: 0,
        totalRaisedUsd: null,
        dealCount: 0,
        stages: [],
      });
      expect(out.unlockBy).toBe('signIn');
      expect((await page('contributor')).unlockBy).toBeNull();
    });
  });

  describe('an edit proposal', () => {
    const propose = (changes: Record<string, unknown>, status = 201) =>
      http()
        .post(`/companies/${slug('D')}/proposals`)
        .set('Authorization', `Bearer ${tokens.contributor}`)
        .send({ changes, attested: true })
        .expect(status);
    const decide = (id: string, status: 'APPROVED' | 'REJECTED') =>
      http()
        .patch(`/admin/submissions/proposal/${id}`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ status })
        .expect(200);
    const row = () =>
      prisma.company.findUniqueOrThrow({
        where: { id: ids.D! },
        select: { verticals: true, partnerFields: true },
      });
    const revisions = (action: string) =>
      prisma.revision.findMany({
        where: { companyId: ids.D!, field: 'verticals', action: action as never },
      });

    it('rejects too many verticals and unknown ones', async () => {
      await propose({ verticals: VERTICALS.slice(0, 6) }, 400);
      await propose({ verticals: ['Nope'] }, 400);
      // Reordering the current value is no change.
      await propose({ verticals: [VERTICAL] }, 400);
    });

    it('is approved as a human edit, then retracted back to the derived value and mark', async () => {
      const submitted = await propose({ verticals: [VERTICAL, 'Retail'] });
      const id = submitted.body.id as string;

      await decide(id, 'APPROVED');
      const approved = await row();
      expect(approved.verticals).toEqual([VERTICAL, 'Retail']);
      expect(approved.partnerFields).not.toContain('verticals');
      expect(approved.partnerFields).toContain('industry');
      expect(await revisions('UPDATE')).toHaveLength(1);
      expect((await profile('D', 'contributor')).verticalSources).toEqual([
        { vertical: VERTICAL, scheme: 'partner', label: 'Defence' },
        { vertical: 'Retail', scheme: 'contributor' },
      ]);

      await decide(id, 'REJECTED');
      const retracted = await row();
      expect(retracted.verticals).toEqual([VERTICAL]);
      expect(retracted.partnerFields).toContain('verticals');
      expect(await revisions('RETRACT')).toHaveLength(1);
    });
  });

  describe('the page threshold and sitemap', () => {
    it('a vertical below the minimum has no page, and an unknown slug 404s', async () => {
      const all = await stats();
      const thin = VERTICALS.find(
        (v) => (all.find((s) => s.vertical === v)?.companyCount ?? 0) < VERTICAL_PAGE_MIN_COMPANIES,
      );
      if (thin) await get(`/market/verticals/${labelSlug(thin)}`, 'contributor', 404);
      else console.log('verticals e2e: every vertical has a page; threshold case skipped');
      await get('/market/verticals/nope', 'signedOut', 404);
    });

    it('lists exactly the indexable verticals', async () => {
      const all = await stats();
      const indexable = all.filter((s) => s.publicCompanyCount >= VERTICAL_PAGE_MIN_COMPANIES);
      expect((await get('/markets/sitemap/count', 'signedOut')).body).toEqual({
        count: indexable.length,
      });
      const entries = (await get('/markets/sitemap', 'signedOut')).body as {
        slug: string;
        updatedAt: string;
      }[];
      expect(entries.map((e) => e.slug).sort()).toEqual(
        indexable.map((s) => `${s.sectorSlug}/${s.slug}`).sort(),
      );
      expect(entries.find((e) => e.slug === `industrials/${SLUG}`)).toBeDefined();
    });
  });
});
