import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';

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
  let managerId: string;
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
      const row = await prisma.fund.create({ data: { ...data, managerId }, select: { id: true } });
      fundIds.push(row.id);
    }
  });

  afterAll(async () => {
    await prisma.fund.deleteMany({ where: { id: { in: fundIds } } });
    await prisma.investor.deleteMany({ where: { id: managerId } });
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
});
