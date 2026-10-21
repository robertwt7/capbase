import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MFA_ACCOUNT_FAILURE_LIMIT,
  MFA_MAX_ATTEMPTS,
  RECOVERY_CODE_COUNT,
  type Role,
} from '@repo/api';

import type { MailService } from '../../mail/mail.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { LAST_FACTOR_MESSAGE, MfaService, SecurityEvent, type MfaUser } from './mfa.service';
import { MfaPolicy } from './policy';
import { totpAt, totpStep } from './totp';

/**
 * A minimal in-memory stand-in for the handful of Prisma calls MfaService makes. `where`
 * supports equality (null included), `{ lt }`, `{ gte }` and `OR` — exactly what the service
 * uses, so a conditional updateMany behaves like the real one.
 */
type Row = Record<string, unknown> & { id: string };
type Where = Record<string, unknown>;

function matches(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((w) => matches(row, w));
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { lt?: unknown; gte?: unknown };
      if (value === null || value === undefined) return false;
      if (c.lt !== undefined && !((value as number) < (c.lt as number))) return false;
      if (c.gte !== undefined && !((value as number) >= (c.gte as number))) return false;
      return true;
    }
    return value === cond || (value === undefined && cond === null);
  });
}

function table(rows: Row[] = []) {
  let seq = 0;
  const apply = (row: Row, data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) {
      row[k] =
        v !== null && typeof v === 'object' && 'increment' in v
          ? ((row[k] as number) ?? 0) + (v as { increment: number }).increment
          : v;
    }
  };
  return {
    rows,
    findUnique: jest.fn(async ({ where }: { where: Where }) => rows.find((r) => matches(r, where)) ?? null),
    findUniqueOrThrow: jest.fn(async ({ where }: { where: Where }) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      return row;
    }),
    findMany: jest.fn(async ({ where }: { where?: Where } = {}) => rows.filter((r) => matches(r, where))),
    count: jest.fn(async ({ where }: { where?: Where } = {}) => rows.filter((r) => matches(r, where)).length),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `row${++seq}`, attempts: 0, consumedAt: null, usedAt: null, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
      for (const d of data) rows.push({ id: `row${++seq}`, usedAt: null, createdAt: new Date(), ...d });
      return { count: data.length };
    }),
    update: jest.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const row = rows.find((r) => matches(r, where))!;
      apply(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const row of hit) apply(row, data);
      return { count: hit.length };
    }),
    deleteMany: jest.fn(async ({ where }: { where?: Where } = {}) => {
      const keep = rows.filter((r) => !matches(r, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    }),
    aggregate: jest.fn(async ({ where }: { where: Where }) => ({
      _sum: {
        attempts: rows.filter((r) => matches(r, where)).reduce((n, r) => n + (r.attempts as number), 0),
      },
    })),
  };
}

const NOW = new Date('2026-10-21T10:00:00Z').getTime();

function setup(role: Role = 'USER', requiredRoles = '') {
  const user: Row & MfaUser = {
    id: 'u1',
    email: 'ada@example.com',
    name: 'Ada',
    role,
    mfaEnabledAt: null,
    totpSecret: null,
    totpEnabledAt: null,
    totpLastStep: null,
  };
  const prisma = {
    user: table([user]),
    authChallenge: table(),
    recoveryCode: table(),
    webAuthnCredential: table(),
    $transaction: jest.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
    ),
  };
  const mail = { sendSecurityNotice: jest.fn(async () => undefined) };
  const config = new ConfigService({ JWT_SECRET: 'test-secret', MFA_REQUIRED_ROLES: requiredRoles });
  const service = new MfaService(
    prisma as unknown as PrismaService,
    mail as unknown as MailService,
    new MfaPolicy(config),
    config,
  );
  return { user, prisma, mail, service };
}

/** Enroll TOTP the way the routes do, returning the base32 secret and recovery codes. */
async function enrollTotp(ctx: ReturnType<typeof setup>) {
  const { challenge, secret } = await ctx.service.beginTotp(ctx.user);
  const codes = await ctx.service.confirmTotp('u1', challenge, totpAt(secret, totpStep() - 1));
  return { secret, codes };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
});

describe('MfaService challenges', () => {
  it('stores only a hash, and loads a live challenge for its own purpose', async () => {
    const { prisma, service } = setup();
    const token = await service.createChallenge('LOGIN_MFA', 'u1');
    expect(token).toHaveLength(43);
    expect(prisma.authChallenge.rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.authChallenge.rows[0]!.tokenHash).not.toBe(token);
    await expect(service.loadChallenge(token, 'LOGIN_MFA')).resolves.toMatchObject({ userId: 'u1' });
  });

  it('rejects a wrong purpose, an expired, a consumed or an unknown challenge', async () => {
    const { service } = setup();
    const token = await service.createChallenge('LOGIN_MFA', 'u1');
    await expect(service.loadChallenge(token, 'MFA_SETUP')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.loadChallenge('x'.repeat(43), 'LOGIN_MFA')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const row = await service.loadChallenge(token, 'LOGIN_MFA');
    await service.consumeChallenge(row.id);
    await expect(service.loadChallenge(token, 'LOGIN_MFA')).rejects.toBeInstanceOf(UnauthorizedException);
    // Single-use: a second consume of the same row loses.
    await expect(service.consumeChallenge(row.id)).rejects.toBeInstanceOf(UnauthorizedException);

    const late = await service.createChallenge('LOGIN_MFA', 'u1');
    jest.setSystemTime(NOW + 5 * 60_000 + 1);
    await expect(service.loadChallenge(late, 'LOGIN_MFA')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('kills a challenge after MFA_MAX_ATTEMPTS failures', async () => {
    const { service } = setup();
    const token = await service.createChallenge('LOGIN_MFA', 'u1');
    for (let i = 0; i < MFA_MAX_ATTEMPTS; i++) {
      await service.recordFailure(await service.loadChallenge(token, 'LOGIN_MFA'));
    }
    await expect(service.loadChallenge(token, 'LOGIN_MFA')).rejects.toThrow(/expired/);
  });

  it('locks the account at MFA_ACCOUNT_FAILURE_LIMIT failures across challenges, emailing once', async () => {
    const { service, mail } = setup();
    for (let i = 0; i < MFA_ACCOUNT_FAILURE_LIMIT; i++) {
      await service.assertNotLocked('u1');
      const token = await service.createChallenge('LOGIN_MFA', 'u1');
      await service.recordFailure(await service.loadChallenge(token, 'LOGIN_MFA'));
    }
    const err = await service.assertNotLocked('u1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(mail.sendSecurityNotice).toHaveBeenCalledTimes(1);
    expect(mail.sendSecurityNotice).toHaveBeenCalledWith('ada@example.com', 'Ada', SecurityEvent.repeatedFailures);

    // The window slides: after the lockout the account can try again.
    jest.setSystemTime(NOW + 16 * 60_000);
    await expect(service.assertNotLocked('u1')).resolves.toBeUndefined();
  });
});

describe('MfaService TOTP', () => {
  it('enrolls with a code, turns 2FA on and issues recovery codes once', async () => {
    const ctx = setup();
    const { challenge, secret, otpauthUri } = await ctx.service.beginTotp(ctx.user);
    expect(otpauthUri).toContain(`secret=${secret}`);
    // The pending secret is stored encrypted, never in the clear.
    expect(ctx.prisma.authChallenge.rows[0]!.pendingSecret).toMatch(/^v1\./);
    expect(ctx.prisma.authChallenge.rows[0]!.pendingSecret).not.toContain(secret);

    const codes = await ctx.service.confirmTotp('u1', challenge, totpAt(secret, totpStep()));
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(ctx.user.totpEnabledAt).toBeInstanceOf(Date);
    expect(ctx.user.mfaEnabledAt).toBeInstanceOf(Date);
    expect(ctx.user.totpSecret).toMatch(/^v1\./);
    expect(ctx.prisma.recoveryCode.rows).toHaveLength(RECOVERY_CODE_COUNT);
    expect(ctx.mail.sendSecurityNotice).toHaveBeenCalledWith('ada@example.com', 'Ada', SecurityEvent.totpAdded);
    await expect(ctx.service.loadChallenge(challenge, 'TOTP_ENROLL')).rejects.toThrow();
  });

  it('refuses a wrong code at enrollment and counts the attempt', async () => {
    const ctx = setup();
    const { challenge } = await ctx.service.beginTotp(ctx.user);
    await expect(ctx.service.confirmTotp('u1', challenge, '000000')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.prisma.authChallenge.rows[0]!.attempts).toBe(1);
    expect(ctx.user.totpEnabledAt).toBeNull();
  });

  it("refuses another user's enrollment challenge", async () => {
    const ctx = setup();
    const { challenge, secret } = await ctx.service.beginTotp(ctx.user);
    await expect(ctx.service.confirmTotp('u2', challenge, totpAt(secret, totpStep()))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a sign-in code once: a replay of the same code fails', async () => {
    const ctx = setup();
    const { secret } = await enrollTotp(ctx);
    const code = totpAt(secret, totpStep());
    await expect(ctx.service.verifyCode(ctx.user, 'totp', code)).resolves.toBe(true);
    expect(ctx.user.totpLastStep).toBe(totpStep());
    await expect(ctx.service.verifyCode(ctx.user, 'totp', code)).resolves.toBe(false);
    // The code enrollment used (one step back) is older than the last accepted step too.
    await expect(ctx.service.verifyCode(ctx.user, 'totp', totpAt(secret, totpStep() - 1))).resolves.toBe(false);
  });

  it('lets only one of two parallel uses of a code win', async () => {
    const ctx = setup();
    const { secret } = await enrollTotp(ctx);
    const code = totpAt(secret, totpStep() + 1);
    const stale = { ...ctx.user };
    const results = await Promise.all([
      ctx.service.verifyCode(stale, 'totp', code),
      ctx.service.verifyCode(stale, 'totp', code),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('turns 2FA off when the app was the only factor, and drops the codes', async () => {
    const ctx = setup();
    await enrollTotp(ctx);
    await ctx.service.disableTotp('u1');
    expect(ctx.user.totpSecret).toBeNull();
    expect(ctx.user.mfaEnabledAt).toBeNull();
    expect(ctx.prisma.recoveryCode.rows).toHaveLength(0);
    expect(ctx.mail.sendSecurityNotice).toHaveBeenLastCalledWith(
      'ada@example.com',
      'Ada',
      SecurityEvent.totpRemoved,
    );
  });

  it('keeps 2FA on when a passkey remains', async () => {
    const ctx = setup();
    await enrollTotp(ctx);
    ctx.prisma.webAuthnCredential.rows.push({ id: 'pk1', userId: 'u1' });
    await ctx.service.disableTotp('u1');
    expect(ctx.user.mfaEnabledAt).toBeInstanceOf(Date);
    expect(ctx.prisma.recoveryCode.rows).toHaveLength(RECOVERY_CODE_COUNT);
  });

  it("refuses to remove a required role's last factor", async () => {
    const ctx = setup('CONTRIBUTOR', 'ADMIN,CONTRIBUTOR');
    await enrollTotp(ctx);
    await expect(ctx.service.disableTotp('u1')).rejects.toThrow(LAST_FACTOR_MESSAGE);
    expect(ctx.user.totpEnabledAt).toBeInstanceOf(Date);
  });
});

describe('MfaService recovery codes', () => {
  it('accepts each code once, in any case or spacing, and reports the remaining count', async () => {
    const ctx = setup();
    const { codes } = await enrollTotp(ctx);
    const code = codes[0]!;
    await expect(ctx.service.verifyCode(ctx.user, 'recovery', ` ${code.toUpperCase()} `.trim())).resolves.toBe(true);
    expect(ctx.mail.sendSecurityNotice).toHaveBeenLastCalledWith(
      'ada@example.com',
      'Ada',
      SecurityEvent.codeUsed(RECOVERY_CODE_COUNT - 1),
    );
    await expect(ctx.service.verifyCode(ctx.user, 'recovery', code)).resolves.toBe(false);
    await expect(ctx.service.verifyCode(ctx.user, 'recovery', 'zzzzz-zzzzz')).resolves.toBe(false);
  });

  it('regenerates a fresh set that invalidates the old one', async () => {
    const ctx = setup();
    const { codes: old } = await enrollTotp(ctx);
    const fresh = await ctx.service.regenerateRecoveryCodes('u1');
    expect(fresh).toHaveLength(RECOVERY_CODE_COUNT);
    await expect(ctx.service.verifyCode(ctx.user, 'recovery', old[0]!)).resolves.toBe(false);
    await expect(ctx.service.verifyCode(ctx.user, 'recovery', fresh[0]!)).resolves.toBe(true);
  });

  it('refuses to regenerate without a factor', async () => {
    const ctx = setup();
    await expect(ctx.service.regenerateRecoveryCodes('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('issues no new codes when a second factor is added and unused ones remain', async () => {
    const ctx = setup();
    await enrollTotp(ctx);
    const { codes } = await ctx.service.factorAdded(ctx.prisma as never, 'u1');
    expect(codes).toEqual([]);
  });
});

describe('MfaService.methodsFor / status', () => {
  it('offers passkey, then totp, then recovery — only what the account has', async () => {
    const ctx = setup();
    expect(await ctx.service.methodsFor(ctx.user)).toEqual([]);
    await enrollTotp(ctx);
    expect(await ctx.service.methodsFor(ctx.user)).toEqual(['totp', 'recovery']);
    ctx.prisma.webAuthnCredential.rows.push({
      id: 'pk1',
      userId: 'u1',
      name: 'Laptop',
      deviceType: 'multiDevice',
      createdAt: new Date(NOW),
      lastUsedAt: null,
    });
    expect(await ctx.service.methodsFor(ctx.user)).toEqual(['passkey', 'totp', 'recovery']);
    expect(await ctx.service.status(ctx.user)).toEqual({
      totpEnabled: true,
      passkeys: [
        { id: 'pk1', name: 'Laptop', deviceType: 'multiDevice', createdAt: new Date(NOW).toISOString(), lastUsedAt: null },
      ],
      recoveryCodesRemaining: RECOVERY_CODE_COUNT,
      required: false,
    });
  });
});
