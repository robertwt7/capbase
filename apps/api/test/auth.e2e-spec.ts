import { createHash } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
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

// Contributions need a confirmed email. Requires Postgres running and migrated,
// and the seeded `helia` company.
describe('Email verification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const prefix = `e2e-verify-${stamp}`;
  const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

  const register = async (tag: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `${prefix}-${tag}@test.dev`, name: 'E2E Verify', password: 'password123' })
      .expect(201);
    return res.body as { accessToken: string; user: { id: string; email: string } };
  };
  const me = (token: string) =>
    request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`);
  const contribute = (token: string) =>
    request(app.getHttpServer())
      .post('/companies/helia/diversity')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'E2E', value: 'yes', note: 'verify e2e', attested: true });
  /** The raw token only ever travels by email, so mint a known one here. */
  const mint = (userId: string, email: string, raw: string, expiresInMs = 60_000) =>
    prisma.emailVerificationToken.create({
      data: { userId, email, tokenHash: hash(raw), expiresAt: new Date(Date.now() + expiresInMs) },
    });
  const verify = (token: string) =>
    request(app.getHttpServer()).post('/auth/verify-email').send({ token });

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
    const users = await prisma.user.findMany({
      where: { email: { startsWith: prefix } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await prisma.diversitySignal.deleteMany({ where: { submittedById: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('blocks contributions until the email is verified, then allows them', async () => {
    const { accessToken, user } = await register('flow');
    const issued = await prisma.emailVerificationToken.count({ where: { userId: user.id } });
    expect(issued).toBe(1);

    const refused = await contribute(accessToken).expect(403);
    expect(refused.body.code).toBe('EMAIL_UNVERIFIED');
    expect((await me(accessToken).expect(200)).body.emailVerified).toBe(false);

    const raw = `${prefix}-flow`;
    await mint(user.id, user.email, raw);
    await verify(raw).expect(200, { ok: true });

    expect((await me(accessToken).expect(200)).body.emailVerified).toBe(true);
    await contribute(accessToken).expect(201);

    // Spent: a replay is refused.
    await verify(raw).expect(400);
  });

  it('refuses an expired token', async () => {
    const { user } = await register('expired');
    const raw = `${prefix}-expired`;
    await mint(user.id, user.email, raw, -1000);
    await verify(raw).expect(400);
  });

  it('refuses a token sent to an address that is no longer the account\'s', async () => {
    const { user } = await register('moved');
    const raw = `${prefix}-moved`;
    await mint(user.id, `${prefix}-old@test.dev`, raw);
    await verify(raw).expect(400);
  });

  it('changing the email clears verification', async () => {
    const { accessToken, user } = await register('change');
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    expect((await me(accessToken).expect(200)).body.emailVerified).toBe(true);

    await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'E2E Verify', email: `${prefix}-changed@test.dev` })
      .expect(200);
    expect((await me(accessToken).expect(200)).body.emailVerified).toBe(false);
    await contribute(accessToken).expect(403);
  });

  it('resend is throttled to one link a minute', async () => {
    const { accessToken } = await register('resend');
    const resend = () =>
      request(app.getHttpServer())
        .post('/auth/resend-verification')
        .set('Authorization', `Bearer ${accessToken}`);
    // Register just issued a link, so the cooldown is already running.
    await resend().expect(429);
  });

  it('resend issues a fresh link once the cooldown has passed', async () => {
    const { accessToken, user } = await register('resend-ok');
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200, { ok: true });
    // The older unused link was retired; only the new one exists.
    expect(await prisma.emailVerificationToken.count({ where: { userId: user.id } })).toBe(1);
    const newest = await prisma.emailVerificationToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(newest.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
