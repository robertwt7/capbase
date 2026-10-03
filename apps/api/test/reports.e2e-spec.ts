import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { AppModule } from './../src/app.module';

// "Report an issue" end to end against the seeded DB: anonymous submission,
// the admin-only queue, and suppress & resolve on a person.
// Requires Postgres running (docker compose up) and the DB seeded.
describe('Reports (e2e)', () => {
  let app: INestApplication;
  let userToken: string;
  let adminToken: string;
  const email = `e2e-report-${Date.now()}@test.dev`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, name: 'E2E Reporter', password: 'password123' })
      .expect(201);
    userToken = reg.body.accessToken;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: process.env.ADMIN_EMAIL ?? 'admin@capbase.fyi',
        password: process.env.ADMIN_PASSWORD ?? 'admin12345',
      })
      .expect(201);
    adminToken = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const report = {
    entityType: 'company',
    slug: 'helia',
    reason: 'Incorrect',
    message: 'The founding year on this profile is wrong.',
  };

  it('accepts an anonymous report', async () => {
    const res = await request(app.getHttpServer())
      .post('/reports')
      .send(report)
      .expect(201);
    expect(typeof res.body.id).toBe('string');
    expect(Object.keys(res.body)).toEqual(['id']);
  });

  it('rejects an unknown reason with 400', async () => {
    await request(app.getHttpServer())
      .post('/reports')
      .send({ ...report, reason: 'Spam' })
      .expect(400);
  });

  it('404s on a slug the public cannot see', async () => {
    await request(app.getHttpServer())
      .post('/reports')
      .send({ ...report, slug: `no-such-company-${Date.now()}` })
      .expect(404);
  });

  it('keeps the queue admin-only', async () => {
    await request(app.getHttpServer()).get('/admin/reports').expect(401);
    await request(app.getHttpServer())
      .get('/admin/reports')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('lets an admin dismiss a report with a note', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/reports')
      .send(report)
      .expect(201);

    const open = await request(app.getHttpServer())
      .get('/admin/reports?status=OPEN')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const item = open.body.items.find((i: { id: string }) => i.id === body.id);
    expect(item.entity.slug).toBe('helia');

    await request(app.getHttpServer())
      .post(`/admin/reports/${body.id}/dismiss`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Matches the filing.' })
      .expect(201);

    const dismissed = await request(app.getHttpServer())
      .get('/admin/reports?status=DISMISSED')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const closed = dismissed.body.items.find(
      (i: { id: string }) => i.id === body.id,
    );
    expect(closed.resolutionNote).toBe('Matches the filing.');
  });

  it('refuses to suppress the subject of a company report', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/reports')
      .send(report)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/admin/reports/${body.id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ suppressPerson: true })
      .expect(400);
  });

  it('suppress & resolve hides a person', async () => {
    const people = await request(app.getHttpServer())
      .get('/people?pageSize=1')
      .expect(200);
    const slug: string | undefined = people.body.items[0]?.slug;
    if (!slug) return; // an unseeded DB has no person to report

    const { body } = await request(app.getHttpServer())
      .post('/reports')
      .send({
        ...report,
        entityType: 'person',
        slug,
        reason: 'Personal data removal',
      })
      .expect(201);

    const open = await request(app.getHttpServer())
      .get('/admin/reports?status=OPEN')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const personId: string = open.body.items.find(
      (i: { id: string }) => i.id === body.id,
    ).entityId;

    try {
      await request(app.getHttpServer())
        .post(`/admin/reports/${body.id}/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ note: 'Removal request', suppressPerson: true })
        .expect(201);

      await request(app.getHttpServer()).get(`/people/${slug}`).expect(404);
    } finally {
      // Put the seeded person back so the suite is re-runnable.
      await request(app.getHttpServer())
        .post(`/admin/people/${personId}/unsuppress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
    }
  });
});
