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

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@capbase.dev', password: 'admin12345' })
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
});
