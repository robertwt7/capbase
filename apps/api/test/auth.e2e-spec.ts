import { createHash } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, it } from '@jest/globals';
import request from 'supertest';

import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Server-side session control: the JWT is only proof of identity, so a
// password change, a reset, a ban or a demotion takes effect on the very next
// request. Requires Postgres running and migrated.
describe('Session revocation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const email = `e2e-auth-${stamp}@test.dev`;

  const register = async (addr: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: addr, name: 'E2E Auth', password: 'password123' })
      .expect(201);
    return res.body as { accessToken: string; user: { id: string } };
  };
  const me = (token: string) =>
    request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-auth-${stamp}` } } });
    await app.close();
  });

  it('a password change revokes old sessions and returns a working new one', async () => {
    const { accessToken: oldToken } = await register(email);
    await me(oldToken).expect(200);

    const changed = await request(app.getHttpServer())
      .post('/auth/me/password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPassword: 'password123', newPassword: 'password456' })
      .expect(201);

    await me(oldToken).expect(401);
    await me(changed.body.accessToken as string).expect(200);
  });

  it('forgot-password answers 200 for unknown emails too', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: `nobody-${stamp}@test.dev` })
      .expect(200, { ok: true });
  });

  it('a reset token works once, sets the password and revokes sessions', async () => {
    const addr = `e2e-auth-${stamp}-reset@test.dev`;
    const { accessToken, user } = await register(addr);

    // The raw token only ever travels by email, so mint a known one here.
    const raw = `e2e-reset-${stamp}`;
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: raw, password: 'brand-new-pass' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: raw, password: 'another-pass' })
      .expect(400);

    await me(accessToken).expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: addr, password: 'brand-new-pass' })
      .expect(201);
  });

  it('an expired reset token is refused', async () => {
    const addr = `e2e-auth-${stamp}-expired@test.dev`;
    const { user } = await register(addr);
    const raw = `e2e-expired-${stamp}`;
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: raw, password: 'brand-new-pass' })
      .expect(400);
  });

  it('a ban kills live sessions and blocks sign-in', async () => {
    const addr = `e2e-auth-${stamp}-ban@test.dev`;
    const { accessToken, user } = await register(addr);
    await prisma.user.update({ where: { id: user.id }, data: { bannedAt: new Date() } });

    await me(accessToken).expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: addr, password: 'password123' })
      .expect(403);
  });

  it('a demoted admin loses /admin on the next request', async () => {
    const addr = `e2e-auth-${stamp}-admin@test.dev`;
    const { accessToken, user } = await register(addr);
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    await request(app.getHttpServer())
      .get('/admin/submissions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await prisma.user.update({ where: { id: user.id }, data: { role: 'USER' } });
    await request(app.getHttpServer())
      .get('/admin/submissions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });
});
