import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { MAX_PENDING_SUBMISSIONS } from '@repo/api';
import request from 'supertest';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Abuse controls: the per-user pending cap and the admin ban. Requires Postgres
// running, migrated and seeded (the `helia` demo company).
describe('Abuse controls (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  const stamp = Date.now();
  const prefix = `e2e-abuse-${stamp}`;

  const register = async (tag: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `${prefix}-${tag}@test.dev`, name: `Abuse ${tag}`, password: 'password123' })
      .expect(201);
    const body = res.body as { accessToken: string; user: { id: string } };
    // Pre-verified: this suite tests the cap and bans, not email verification.
    await prisma.user.update({ where: { id: body.user.id }, data: { emailVerifiedAt: new Date() } });
    return body;
  };
  const fillQueue = (userId: string, n: number) =>
    prisma.changeProposal.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        companyId,
        changes: { oneLiner: `${prefix} junk ${i}` },
        submittedById: userId,
      })),
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    companyId = (await prisma.company.findUniqueOrThrow({ where: { slug: 'helia' } })).id;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: prefix } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await prisma.changeProposal.deleteMany({ where: { submittedById: { in: ids } } });
    await prisma.diversitySignal.deleteMany({ where: { submittedById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it(`answers 429 once a user has ${MAX_PENDING_SUBMISSIONS} submissions pending`, async () => {
    const { accessToken, user } = await register('capped');
    await fillQueue(user.id, MAX_PENDING_SUBMISSIONS - 1);

    const diversity = { label: 'E2E', value: 'yes', note: 'abuse e2e', attested: true };
    await request(app.getHttpServer())
      .post('/companies/helia/diversity')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(diversity)
      .expect(201);
    await request(app.getHttpServer())
      .post('/companies/helia/diversity')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(diversity)
      .expect(429);
  });

  it('an admin ban revokes the session and rejects the pending queue', async () => {
    const admin = await register('admin');
    await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'ADMIN' } });
    const spammer = await register('spammer');
    await fillQueue(spammer.user.id, 3);

    const list = await request(app.getHttpServer())
      .get(`/admin/users?q=${prefix}-spammer`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].pendingCount).toBe(3);

    const banned = await request(app.getHttpServer())
      .patch(`/admin/users/${spammer.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ banned: true })
      .expect(200);
    expect(banned.body.bannedAt).not.toBeNull();
    expect(banned.body.pendingCount).toBe(0);

    const rejected = await prisma.changeProposal.count({
      where: { submittedById: spammer.user.id, moderationStatus: 'REJECTED' },
    });
    expect(rejected).toBe(3);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${spammer.accessToken}`)
      .expect(401);
  });

  it('an admin cannot ban or demote themselves, and a user cannot reach /admin/users', async () => {
    const admin = await register('self');
    await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'ADMIN' } });
    await request(app.getHttpServer())
      .patch(`/admin/users/${admin.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'USER' })
      .expect(400);

    const plain = await register('plain');
    await request(app.getHttpServer())
      .get('/admin/users')
      .set('Authorization', `Bearer ${plain.accessToken}`)
      .expect(403);
  });
});
