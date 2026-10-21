import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { MFA_MAX_ATTEMPTS, MFA_REQUIRED, RECOVERY_CODE_COUNT } from '@repo/api';

import { ApiKeysService } from './../src/api-keys/api-keys.service';
import { AppModule } from './../src/app.module';
import { MfaPolicy } from './../src/auth/mfa/policy';
import { totpAt, totpStep } from './../src/auth/mfa/totp';
import { PrismaService } from './../src/prisma/prisma.service';

// Two-factor enforcement end to end, with MFA_REQUIRED_ROLES=ADMIN,CONTRIBUTOR (the production
// default — it is off under test unless overridden, so every other suite signs in with a
// password as before). Codes come from `totpAt`, so no authenticator is needed; passkey
// ceremonies are covered by unit tests and by hand.
//
// Users are created with Prisma and sessions signed with JwtService, so the suite spends few
// /auth calls (AUTH_LIMIT is 20 a minute per route). Cleanup deletes only the ids it created —
// `where: { id: undefined }` is NO filter in Prisma.
describe('Two-factor authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const password = 'correct-horse-battery';
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  let contributorId: string | undefined;
  let adminId: string | undefined;
  const contributorEmail = `e2e-mfa-${stamp}@test.dev`;
  let adminJwt: string;
  let key: string;

  // Shared across the ordered steps below.
  let secret: string;
  let session: string;
  let recoveryCodes: string[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MfaPolicy)
      .useValue(
        new MfaPolicy(new ConfigService({ MFA_REQUIRED_ROLES: 'ADMIN,CONTRIBUTOR' })),
      )
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const passwordHash = await bcrypt.hash(password, 10);
    contributorId = (
      await prisma.user.create({
        data: {
          email: contributorEmail,
          name: 'MFA e2e',
          passwordHash,
          role: 'CONTRIBUTOR',
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;
    // The admin is enrolled already, so its session passes enforcement.
    const admin = await prisma.user.create({
      data: {
        email: `e2e-mfa-admin-${stamp}@test.dev`,
        name: 'MFA e2e admin',
        passwordHash,
        role: 'ADMIN',
        emailVerifiedAt: new Date(),
        mfaEnabledAt: new Date(),
      },
    });
    adminId = admin.id;
    adminJwt = app
      .get(JwtService)
      .sign({ sub: admin.id, email: admin.email, role: admin.role, tv: admin.tokenVersion });
    key = (
      await app
        .get(ApiKeysService)
        .create(
          { id: contributorId, role: 'CONTRIBUTOR', emailVerified: true },
          { name: `e2e-mfa-${stamp}`, scope: 'contributor' },
        )
    ).token;
  });

  afterAll(async () => {
    // Keys, passkeys, recovery codes and challenges cascade.
    if (contributorId) await prisma.user.delete({ where: { id: contributorId } });
    if (adminId) await prisma.user.delete({ where: { id: adminId } });
    await app.close();
  });

  const login = () =>
    http().post('/auth/login').send({ email: contributorEmail, password }).expect(201);

  it('gives an un-enrolled contributor no session, no key, and forced setup at sign-in', async () => {
    const jwt = app
      .get(JwtService)
      .sign({ sub: contributorId, email: contributorEmail, role: 'CONTRIBUTOR', tv: 0 });
    await http().get('/auth/me').set(bearer(jwt)).expect(401);

    const v1 = await http().get('/v1/me').set(bearer(key)).expect(403);
    expect(v1.body).toMatchObject({ code: MFA_REQUIRED });

    const res = await login();
    expect(res.body).toEqual({ status: 'mfa_setup', challenge: expect.any(String) });
    expect(res.body).not.toHaveProperty('accessToken');

    // Forced setup with an authenticator app.
    const setup = await http()
      .post('/auth/login/setup/totp')
      .send({ challenge: res.body.challenge })
      .expect(200);
    secret = setup.body.secret;
    expect(setup.body.otpauthUri).toContain(encodeURIComponent(contributorEmail));

    const done = await http()
      .post('/auth/login/setup/totp/confirm')
      .send({
        challenge: res.body.challenge,
        totpChallenge: setup.body.challenge,
        code: totpAt(secret, totpStep()),
      })
      .expect(200);
    expect(done.body.status).toBe('ok');
    expect(done.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(done.body.user.mfaEnabled).toBe(true);
    recoveryCodes = done.body.recoveryCodes;

    await http().get('/auth/me').set(bearer(done.body.accessToken)).expect(200);
    // Enrolling restores the key: it was suspended, never revoked.
    await http().get('/v1/me').set(bearer(key)).expect(200);
  });

  it('asks for the second factor and kills a challenge after too many wrong codes', async () => {
    const first = await login();
    expect(first.body).toMatchObject({ status: 'mfa', methods: ['totp', 'recovery'] });
    expect(first.body).not.toHaveProperty('accessToken');

    const wrong = totpAt(secret, totpStep() - 5);
    for (let i = 0; i < MFA_MAX_ATTEMPTS; i++) {
      await http()
        .post('/auth/login/mfa')
        .send({ challenge: first.body.challenge, method: 'totp', code: wrong })
        .expect(401);
    }
    // Spent: even a correct code no longer works on it.
    const dead = await http()
      .post('/auth/login/mfa')
      .send({ challenge: first.body.challenge, method: 'totp', code: totpAt(secret, totpStep() + 1) })
      .expect(401);
    expect(dead.body.message).toMatch(/expired/);

    // A fresh challenge with the next step's code (the setup code used the current one).
    const second = await login();
    const code = totpAt(secret, totpStep() + 1);
    const ok = await http()
      .post('/auth/login/mfa')
      .send({ challenge: second.body.challenge, method: 'totp', code })
      .expect(200);
    expect(ok.body.status).toBe('ok');
    session = ok.body.accessToken;
    await http().get('/auth/me').set(bearer(session)).expect(200);

    // The same code again is a replay; a recovery code still works, once.
    const third = await login();
    await http()
      .post('/auth/login/mfa')
      .send({ challenge: third.body.challenge, method: 'totp', code })
      .expect(401);
    const recovered = await http()
      .post('/auth/login/mfa')
      .send({ challenge: third.body.challenge, method: 'recovery', code: recoveryCodes[0] })
      .expect(200);
    expect(recovered.body.status).toBe('ok');
  });

  it("refuses to remove a required role's last factor", async () => {
    const res = await http()
      .post('/auth/me/mfa/totp/disable')
      .set(bearer(session))
      .send({ password })
      .expect(400);
    expect(res.body.message).toMatch(/requires two-factor/);

    const status = await http().get('/auth/me/mfa').set(bearer(session)).expect(200);
    expect(status.body).toMatchObject({
      totpEnabled: true,
      passkeys: [],
      recoveryCodesRemaining: RECOVERY_CODE_COUNT - 1,
      required: true,
    });
  });

  it('lets an admin reset 2FA, which ends every session and suspends the key', async () => {
    const res = await http()
      .post(`/admin/users/${contributorId}/reset-mfa`)
      .set(bearer(adminJwt))
      .expect(201);
    expect(res.body.mfaEnabled).toBe(false);

    await http().get('/auth/me').set(bearer(session)).expect(401);
    const v1 = await http().get('/v1/me').set(bearer(key)).expect(403);
    expect(v1.body).toMatchObject({ code: MFA_REQUIRED });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: contributorId } });
    expect(row.totpSecret).toBeNull();
    expect(await prisma.recoveryCode.count({ where: { userId: contributorId } })).toBe(0);
  });
});
