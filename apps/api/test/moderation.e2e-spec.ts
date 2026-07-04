import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { AppModule } from './../src/app.module';

// Exercises the crowdsource -> moderation cycle end to end against the seeded DB.
// Requires Postgres running (docker compose up) and the DB seeded.
describe('Submissions & moderation (e2e)', () => {
  let app: INestApplication;
  let userToken: string;
  let adminToken: string;
  const email = `e2e-${Date.now()}@test.dev`;
  const roundName = `E2E Round ${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a contributor and an admin can log in', async () => {
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, name: 'E2E User', password: 'password123' })
      .expect(201);
    expect(reg.body.user.role).toBe('USER');
    userToken = reg.body.accessToken;

    // The seeded admin credentials come from env (see packages/db/prisma/seed.ts),
    // loaded into process.env by ConfigModule during app.init().
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: process.env.ADMIN_EMAIL ?? 'admin@capbase.fyi',
        password: process.env.ADMIN_PASSWORD ?? 'admin12345',
      })
      .expect(201);
    expect(login.body.user.role).toBe('ADMIN');
    adminToken = login.body.accessToken;
  });

  it('rejects an invalid submission with 400', async () => {
    await request(app.getHttpServer())
      .post('/companies/helia/rounds')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: '', date: 'not-a-date', amountUsd: -1, investors: [] })
      .expect(400);
  });

  it('blocks non-admins from the moderation queue with 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/submissions')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('hides a pending submission until an admin approves it', async () => {
    // Submit a new round (PENDING).
    const submit = await request(app.getHttpServer())
      .post('/companies/helia/rounds')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        name: roundName,
        date: '2025-12-01',
        amountUsd: 100_000_000,
        postMoneyUsd: 50_000_000_000,
        lead: 'E2E Capital',
        investors: [{ name: 'E2E Capital', lead: true }],
      })
      .expect(201);
    expect(submit.body.moderationStatus).toBe('PENDING');
    const roundId = submit.body.id;

    // Not visible yet (still PENDING). Read as the contributor, who is unlocked
    // by their own submission, so the gate returns the full approved round list.
    const before = await request(app.getHttpServer())
      .get('/companies/helia')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(before.body.company.rounds.some((r: { name: string }) => r.name === roundName)).toBe(
      false,
    );

    // Appears in the admin queue.
    const queue = await request(app.getHttpServer())
      .get('/admin/submissions?status=PENDING')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(queue.body.items.some((i: { id: string }) => i.id === roundId)).toBe(true);

    // Approve it.
    await request(app.getHttpServer())
      .patch(`/admin/submissions/round/${roundId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' })
      .expect(200);

    // Now visible to the (unlocked) contributor.
    const after = await request(app.getHttpServer())
      .get('/companies/helia')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(after.body.company.rounds.some((r: { name: string }) => r.name === roundName)).toBe(
      true,
    );
  });

  it('applies an approved edit proposal to the company', async () => {
    // Read the live values so the proposal is a real diff.
    const before = await request(app.getHttpServer())
      .get('/companies/helia')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const newHq = `E2E City ${Date.now()}`;
    const newHeadcount = before.body.company.headcount + 1;

    // A no-op diff is rejected outright.
    await request(app.getHttpServer())
      .post('/companies/helia/proposals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ changes: { hq: before.body.company.hq } })
      .expect(400);

    // Submit a real proposal (PENDING).
    const submit = await request(app.getHttpServer())
      .post('/companies/helia/proposals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        changes: { hq: newHq, headcount: newHeadcount },
        note: 'e2e correction',
      })
      .expect(201);
    expect(submit.body.moderationStatus).toBe('PENDING');
    const proposalId = submit.body.id;

    // The queue carries the diff plus the company's current values.
    const queue = await request(app.getHttpServer())
      .get('/admin/submissions?status=PENDING')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const item = queue.body.items.find((i: { id: string }) => i.id === proposalId);
    expect(item.type).toBe('proposal');
    expect(item.data.changes).toEqual({ hq: newHq, headcount: newHeadcount });
    expect(item.data.current.hq).toBe(before.body.company.hq);
    expect(item.data.note).toBe('e2e correction');
    expect(queue.body.countsByType.proposal).toBeGreaterThanOrEqual(1);

    // Approve — the company row is updated in the same stroke.
    await request(app.getHttpServer())
      .patch(`/admin/submissions/proposal/${proposalId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/companies/helia')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(after.body.company.hq).toBe(newHq);
    expect(after.body.company.headcount).toBe(newHeadcount);
  });

  it('leaves the company untouched when a proposal is rejected', async () => {
    const before = await request(app.getHttpServer())
      .get('/companies/helia')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const submit = await request(app.getHttpServer())
      .post('/companies/helia/proposals')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ changes: { oneLiner: 'Rejected e2e one-liner' } })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/admin/submissions/proposal/${submit.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED' })
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/companies/helia')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(after.body.company.oneLiner).toBe(before.body.company.oneLiner);
  });
});
