import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { SITEMAP_PAGE_SIZE, type SitemapCount } from '@repo/api';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// The thin-profile indexing gate, end to end against Postgres. The sitemap
// queries are raw SQL (people) and relation filters (investors) that a mocked
// Prisma can't execute, and the detail read derives `indexable` separately —
// so this checks, per fixture, that the two agree with each other and with the
// rule. Requires Postgres running (docker compose up); seeds and removes its
// own rows.
/** The sitemap reads walk every indexable row; on a full dataset (half a million people
 *  after a partner snapshot) one takes seconds, and these tests make several. */
const SITEMAP_TIMEOUT_MS = 60_000;

describe('Indexing gate (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const s = (name: string) => `e2e-idx-${name}-${stamp}`;

  const companyIds: string[] = [];
  const investorIds: string[] = [];
  const personIds: string[] = [];

  /** slug → expected `indexable`. Suppressed/merged people are absent from both reads. */
  const people: Record<string, boolean> = {};
  const investors: Record<string, boolean> = {};
  const funds: Record<string, boolean> = {};

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const company = async (name: string, moderationStatus: 'APPROVED' | 'PENDING') => {
      const row = await prisma.company.create({
        data: {
          slug: s(name),
          name: `E2E ${name} ${stamp}`,
          domain: '',
          oneLiner: '',
          description: '',
          hq: '',
          founded: 0,
          headcount: 0,
          status: 'Private',
          stage: 'Seed',
          totalRaisedUsd: 0n,
          moderationStatus,
        },
        select: { id: true },
      });
      companyIds.push(row.id);
      return row.id;
    };
    const live = await company('live-co', 'APPROVED');
    const pending = await company('pending-co', 'PENDING');

    const investor = async (name: string) => {
      const row = await prisma.investor.create({
        data: { slug: s(name), name: `E2E ${name} ${stamp}`, type: 'Venture', moderationStatus: 'APPROVED' },
        select: { id: true },
      });
      investorIds.push(row.id);
      return row.id;
    };

    const person = async (
      name: string,
      roles: { companyId?: string; investorId?: string }[],
      extra: { suppressedAt?: Date; mergedIntoId?: string } = {},
    ) => {
      const row = await prisma.person.create({
        data: {
          slug: s(name),
          name: `E2E ${name}`,
          normalizedName: `e2e ${name} ${stamp}`,
          moderationStatus: 'APPROVED',
          ...extra,
        },
        select: { id: true },
      });
      personIds.push(row.id);
      for (const [i, r] of roles.entries()) {
        await prisma.personRole.create({
          data: {
            personId: row.id,
            ...r,
            name: `E2E ${name}`,
            role: 'Director',
            since: 2020 + i,
            moderationStatus: 'APPROVED',
          },
        });
      }
      return row.id;
    };

    // ── People ────────────────────────────────────────────────────────────
    await person('one-role', [{ companyId: live }]);
    people[s('one-role')] = false;

    const twoRoles = await person('two-roles', [{ companyId: live }, { companyId: live }]);
    people[s('two-roles')] = true;

    const qid = await person('qid', [{ companyId: live }]);
    await prisma.entityIdentifier.create({
      data: { scheme: 'WIKIDATA', value: `Q9${stamp}`, entityType: 'person', entityId: qid, source: 'E2E' },
    });
    people[s('qid')] = true;

    // An approved role on a company the public can't see doesn't count — the
    // SQL must restate PUBLIC_ROLES, not just the role's own status.
    await person('hidden-second-role', [{ companyId: live }, { companyId: pending }]);
    people[s('hidden-second-role')] = false;

    // Firm-officer roles have no company and count in full.
    const officerFirm = await investor('officer-firm');
    await person('firm-officer', [{ investorId: officerFirm }, { investorId: officerFirm }]);
    people[s('firm-officer')] = true;

    await person('suppressed', [{ companyId: live }, { companyId: live }], { suppressedAt: new Date() });
    await person('merged', [{ companyId: live }, { companyId: live }], { mergedIntoId: twoRoles });

    // ── Investors ─────────────────────────────────────────────────────────
    await investor('empty');
    investors[s('empty')] = false;

    const fundsOnly = await investor('funds-only');
    await prisma.fund.create({
      data: { name: `E2E Fund ${stamp}`, managerId: fundsOnly, moderationStatus: 'APPROVED' },
    });
    investors[s('funds-only')] = true;

    const holdingOnly = await investor('holding-only');
    await prisma.investorHolding.create({
      data: {
        companyId: live,
        investorId: holdingOnly,
        name: 'E2E holding',
        type: 'Venture',
        firstRound: 'Seed',
        rounds: 1,
        moderationStatus: 'APPROVED',
      },
    });
    investors[s('holding-only')] = true;

    // A holding on a hidden company is one the page doesn't show.
    const hiddenHolding = await investor('hidden-holding');
    await prisma.investorHolding.create({
      data: {
        companyId: pending,
        investorId: hiddenHolding,
        name: 'E2E holding',
        type: 'Venture',
        firstRound: 'Seed',
        rounds: 1,
        moderationStatus: 'APPROVED',
      },
    });
    investors[s('hidden-holding')] = false;

    investors[s('officer-firm')] = true;

    // ── Funds and limited partners ────────────────────────────────────────
    const fund = async (name: string, data: Record<string, unknown> = {}) =>
      (
        await prisma.fund.create({
          data: { slug: s(name), name: `E2E ${name} ${stamp}`, managerId: fundsOnly, moderationStatus: 'APPROVED', ...data },
          select: { id: true },
        })
      ).id;
    await fund('bare-fund', { grossAssetsUsd: 101n });
    funds[s('bare-fund')] = false;
    await fund('sized-fund', { closedUsd: 250_000_000n });
    funds[s('sized-fund')] = true;
    await fund('fee-fund', { managementFeePct: 2 });
    funds[s('fee-fund')] = true;
    const committed = await fund('committed-fund');
    funds[s('committed-fund')] = true;

    // An LP whose only public fact is a commitment is worth indexing.
    const lpOnly = await investor('lp-only');
    await prisma.fundCommitment.create({
      data: { fundId: committed, investorId: lpOnly, moderationStatus: 'APPROVED' },
    });
    investors[s('lp-only')] = true;
  });

  afterAll(async () => {
    await prisma.entityIdentifier.deleteMany({ where: { entityType: 'person', entityId: { in: personIds } } });
    await prisma.personRole.deleteMany({ where: { personId: { in: personIds } } });
    await prisma.person.deleteMany({ where: { id: { in: personIds } } });
    await prisma.fund.deleteMany({ where: { managerId: { in: investorIds } } });
    await prisma.investor.deleteMany({ where: { id: { in: investorIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await app.close();
  });

  /** Every page of a family's sitemap feed, with no slug on two pages. (Not
   *  "the pages add up to `/count`": suites run in parallel and others create
   *  and delete firms between the two reads.) */
  const slugSet = async (path: string) => {
    const { body: total } = await request(app.getHttpServer()).get(`${path}/count`).expect(200);
    const slugs = new Set<string>();
    let listed = 0;
    for (let page = 0; page * SITEMAP_PAGE_SIZE < (total as SitemapCount).count; page++) {
      const res = await request(app.getHttpServer()).get(`${path}?page=${page}`).expect(200);
      const rows = res.body as { slug: string }[];
      listed += rows.length;
      rows.forEach((r) => slugs.add(r.slug));
    }
    expect(slugs.size).toBe(listed);
    return slugs;
  };

  it('people: the sitemap lists exactly the profiles that are indexable', async () => {
    const sitemap = await slugSet('/people/sitemap');
    for (const [slug, expected] of Object.entries(people)) {
      const res = await request(app.getHttpServer()).get(`/people/${slug}`).expect(200);
      expect({ slug, indexable: res.body.indexable }).toEqual({ slug, indexable: expected });
      expect({ slug, inSitemap: sitemap.has(slug) }).toEqual({ slug, inSitemap: expected });
    }
    // Neither suppressed nor merged people are listed, however many roles they hold.
    expect(sitemap.has(s('suppressed'))).toBe(false);
    expect(sitemap.has(s('merged'))).toBe(false);
  }, SITEMAP_TIMEOUT_MS);

  it('investors: the sitemap lists exactly the profiles that are indexable', async () => {
    const sitemap = await slugSet('/investors/sitemap');
    for (const [slug, expected] of Object.entries(investors)) {
      const res = await request(app.getHttpServer()).get(`/investors/${slug}`).expect(200);
      expect({ slug, indexable: res.body.indexable }).toEqual({ slug, indexable: expected });
      expect({ slug, inSitemap: sitemap.has(slug) }).toEqual({ slug, inSitemap: expected });
    }
  }, SITEMAP_TIMEOUT_MS);

  it('funds: the sitemap lists exactly the fund pages that are indexable', async () => {
    const sitemap = await slugSet('/funds/sitemap');
    for (const [slug, expected] of Object.entries(funds)) {
      const res = await request(app.getHttpServer()).get(`/funds/${slug}`).expect(200);
      expect({ slug, indexable: res.body.indexable }).toEqual({ slug, indexable: expected });
      expect({ slug, inSitemap: sitemap.has(slug) }).toEqual({ slug, inSitemap: expected });
    }
  }, SITEMAP_TIMEOUT_MS);
});
