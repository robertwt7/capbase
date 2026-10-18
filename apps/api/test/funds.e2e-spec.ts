import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { SITEMAP_PAGE_SIZE, type SitemapCount } from '@repo/api';

import { ApiKeysService } from './../src/api-keys/api-keys.service';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Exercises /funds end to end against the seeded DB. Requires Postgres running
// (docker compose up). Seeds its own manager and funds so the assertions do not
// depend on whether an ingest has been run.
describe('Funds directory (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const managerSlug = `e2e-fund-manager-${stamp}`;
  // Optional until created: cleanup must never run a `where: { id: undefined }`,
  // which Prisma reads as NO filter (it would delete every row in the table).
  let managerId: string | undefined;
  let lpId: string | undefined;
  let userId: string | undefined;
  let key: string;
  const lpSlug = `e2e-fund-lp-${stamp}`;
  const pageSlug = `e2e-alpha-fund-i-${stamp}`;
  const fundIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const manager = await prisma.investor.create({
      data: {
        slug: managerSlug,
        name: `E2E Fund Manager ${stamp}`,
        type: 'Venture',
        crdNumber: `e2e-${stamp}`,
        fundCount: 3,
        moderationStatus: 'APPROVED',
      },
      select: { id: true },
    });
    managerId = manager.id;

    for (const data of [
      {
        slug: pageSlug,
        name: `E2E Alpha Fund I ${stamp}`,
        strategy: 'Venture capital',
        vintageYear: 2021,
        grossAssetsUsd: 900_000_000n,
        moderationStatus: 'APPROVED' as const,
      },
      {
        name: `E2E Beta Buyout Fund ${stamp}`,
        strategy: 'Private equity',
        vintageYear: 2024,
        grossAssetsUsd: 100_000_000n,
        moderationStatus: 'APPROVED' as const,
      },
      {
        name: `E2E Pending Fund ${stamp}`,
        strategy: 'Venture capital',
        vintageYear: 2025,
        grossAssetsUsd: 5_000_000_000n,
        moderationStatus: 'PENDING' as const,
      },
    ]) {
      const row = await prisma.fund.create({ data: { ...data, managerId: managerId! }, select: { id: true } });
      fundIds.push(row.id);
    }

    // A limited partner committing to the first fund, plus a metric.
    lpId = (
      await prisma.investor.create({
        data: { slug: lpSlug, name: `E2E Pension Plan ${stamp}`, type: 'Pension fund', moderationStatus: 'APPROVED' },
        select: { id: true },
      })
    ).id;
    await prisma.fund.update({
      where: { id: fundIds[0] },
      data: { status: 'Closed', finalCloseDate: new Date('2021-06-30'), managementFeePct: 2, carriedInterestPct: 20 },
    });
    await prisma.fundCommitment.create({
      data: {
        fundId: fundIds[0]!,
        investorId: lpId!,
        amountUsd: 55_000_000n,
        amountLocal: 50_000_000n,
        currency: 'EUR',
        externalSource: 'E2E',
        externalId: `${stamp}`,
        moderationStatus: 'APPROVED',
      },
    });
    await prisma.fundMetric.create({
      data: { fundId: fundIds[0]!, asAt: new Date('2024-06-30'), aumUsd: 1_000_000_000n },
    });

    // No /auth calls (throttled at 20/min across the whole e2e run): the key's
    // owner is created directly and the key minted through the service.
    const owner = await prisma.user.create({
      data: {
        email: `e2e-funds-${stamp}@test.dev`,
        name: 'Funds e2e',
        passwordHash: 'unused',
        role: 'CONTRIBUTOR',
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });
    userId = owner.id;
    key = (
      await app
        .get(ApiKeysService)
        .create(
          { id: owner.id, role: 'CONTRIBUTOR', emailVerified: true },
          { name: `e2e-funds-${stamp}`, scope: 'contributor' },
        )
    ).token;
  });

  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } }); // keys cascade
    await prisma.fund.deleteMany({ where: { id: { in: fundIds } } });
    const firms = [managerId, lpId].filter((id): id is string => !!id);
    if (firms.length) await prisma.investor.deleteMany({ where: { id: { in: firms } } });
    await app.close();
  });

  it('lists a manager’s approved funds, largest first, and hides the PENDING one', async () => {
    const res = await request(app.getHttpServer())
      .get(`/funds?manager=${managerSlug}`)
      .expect(200);

    expect(res.body.total).toBe(2);
    expect(res.body.items.map((f: { name: string }) => f.name)).toEqual([
      `E2E Alpha Fund I ${stamp}`,
      `E2E Beta Buyout Fund ${stamp}`,
    ]);
    expect(res.body.items[0].manager.slug).toBe(managerSlug);
    // Money crosses the wire as a number, not a BigInt string.
    expect(res.body.items[0].grossAssetsUsd).toBe(900_000_000);
  });

  it('sorts by vintage, newest first', async () => {
    const res = await request(app.getHttpServer())
      .get(`/funds?manager=${managerSlug}&sort=vintage`)
      .expect(200);

    expect(res.body.items.map((f: { vintageYear: number }) => f.vintageYear)).toEqual([2024, 2021]);
  });

  it('filters by strategy', async () => {
    const res = await request(app.getHttpServer())
      .get(`/funds?manager=${managerSlug}&strategy=Private%20equity`)
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.items[0].strategy).toBe('Private equity');
  });

  it('searches by name, case-insensitively', async () => {
    const res = await request(app.getHttpServer())
      .get(`/funds?manager=${managerSlug}&q=beta+buyout`)
      .expect(200);

    expect(res.body.total).toBe(1);
  });

  it('paginates', async () => {
    const res = await request(app.getHttpServer())
      .get(`/funds?manager=${managerSlug}&pageSize=1&page=2`)
      .expect(200);

    expect(res.body).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(res.body.items).toHaveLength(1);
  });

  it('400s on a strategy outside the controlled vocabulary', async () => {
    await request(app.getHttpServer()).get('/funds?strategy=bogus').expect(400);
  });

  it('reports the named funds and the SEC-reported count separately on the profile', async () => {
    const res = await request(app.getHttpServer())
      .get(`/investors/${managerSlug}`)
      .expect(200);

    // What we can name vs what the firm told the SEC — two different facts.
    expect(res.body.namedFundCount).toBe(2);
    expect(res.body.fundCount).toBe(3);
    expect(res.body.funds).toHaveLength(2);
    expect(res.body.citations).toEqual([]);
  });

  /** A contributor's session: the fund page is gated, and these tests read it
   *  whole (the gate itself is covered by gate.e2e-spec.ts). */
  const unlocked = () => ({
    Authorization: `Bearer ${app.get(JwtService).sign({ sub: userId, email: `e2e-funds-${stamp}@test.dev`, role: 'CONTRIBUTOR', tv: 0 })}`,
  });

  it('serves the fund page with terms, commitments and metrics', async () => {
    const res = await request(app.getHttpServer()).get(`/funds/${pageSlug}`).set(unlocked()).expect(200);
    expect(res.body.fund).toMatchObject({
      slug: pageSlug,
      status: 'Closed',
      finalCloseDate: '2021-06-30',
      managementFeePct: 2,
      carriedInterestPct: 20,
      manager: { slug: managerSlug },
    });
    expect(res.body.commitmentCount).toBe(1);
    expect(res.body.commitments).toEqual([
      expect.objectContaining({
        investor: { slug: lpSlug, name: `E2E Pension Plan ${stamp}`, type: 'Pension fund' },
        amountUsd: 55_000_000,
        amountLocal: 50_000_000,
        currency: 'EUR',
      }),
    ]);
    expect(res.body.metrics).toEqual([
      { asAt: '2024-06-30', aumUsd: 1_000_000_000, dryPowderUsd: null, unrealizedUsd: null },
    ]);
    expect(res.body.indexable).toBe(true);
  });

  it('404s an unknown fund slug', async () => {
    await request(app.getHttpServer()).get(`/funds/no-such-fund-${stamp}`).expect(404);
  });

  it('withholds the terms, commitments and metrics from a signed-out viewer', async () => {
    const res = await request(app.getHttpServer()).get(`/funds/${pageSlug}`).expect(200);
    expect(res.body.fund.managementFeePct).toBeNull();
    expect(res.body.termsHidden).toBe(true);
    expect(res.body.commitments).toEqual([]);
    expect(res.body.metrics).toEqual([]);
    expect(res.body.commitmentCount).toBe(1);
    expect(res.body.indexable).toBe(true);
  });

  it('lists an LP’s commitments on its investor profile, linking the fund', async () => {
    const res = await request(app.getHttpServer()).get(`/investors/${lpSlug}`).set(unlocked()).expect(200);
    expect(res.body.commitmentCount).toBe(1);
    expect(res.body.commitments[0]).toMatchObject({
      fund: { slug: pageSlug, name: `E2E Alpha Fund I ${stamp}` },
      manager: { slug: managerSlug },
      amountUsd: 55_000_000,
    });
    // An LP with only commitments is worth indexing.
    expect(res.body.indexable).toBe(true);
  });

  it('lists the indexable fund in the sitemap', async () => {
    // Paged by slug, so walk every page: the fixture's page depends on the dataset.
    const { body } = await request(app.getHttpServer()).get('/funds/sitemap/count').expect(200);
    const pages = Math.ceil((body as SitemapCount).count / SITEMAP_PAGE_SIZE);
    let found = false;
    for (let page = 0; page < pages && !found; page++) {
      const res = await request(app.getHttpServer()).get(`/funds/sitemap?page=${page}`).expect(200);
      found = (res.body as { slug: string }[]).some((r) => r.slug === pageSlug);
    }
    expect(found).toBe(true);
  });

  it('rejects a malformed sitemap page', async () => {
    await request(app.getHttpServer()).get('/funds/sitemap?page=-1').expect(400);
  });

  it('filters the directory by status (a signed-in filter: status is partner data)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/funds?manager=${managerSlug}&status=Closed`)
      .set(unlocked())
      .expect(200);
    expect(res.body.items.map((f: { slug: string }) => f.slug)).toEqual([pageSlug]);
    await request(app.getHttpServer()).get('/funds?status=bogus').expect(400);
  });

  it('serves the same fund over /v1 with a key', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/funds/${pageSlug}`)
      .set({ Authorization: `Bearer ${key}` })
      .expect(200);
    expect(res.body.fund.slug).toBe(pageSlug);
    expect(res.body.commitmentCount).toBe(1);
  });
});
