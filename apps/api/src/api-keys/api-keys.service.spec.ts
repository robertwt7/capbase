import { createHash } from 'node:crypto';

import { describe, it, expect, jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_UNVERIFIED, MAX_ACTIVE_API_KEYS, MFA_REQUIRED, type Role } from '@repo/api';

import { MfaPolicy } from '../auth/mfa/policy';
import type { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService, ipAllowed, parseCidr } from './api-keys.service';

/** 2FA enforcement off, as outside production by default. */
const noMfa = new MfaPolicy(new ConfigService({}));
const mfaOn = new MfaPolicy(new ConfigService({ MFA_REQUIRED_ROLES: 'ADMIN,CONTRIBUTOR' }));

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type Owner = {
  id: string;
  email: string;
  role: Role;
  bannedAt: Date | null;
  emailVerifiedAt: Date | null;
  mfaEnabledAt: Date | null;
};

const owner = (over: Partial<Owner> = {}): Owner => ({
  id: 'u1',
  email: 'u@test.dev',
  role: 'CONTRIBUTOR',
  bannedAt: null,
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  mfaEnabledAt: null,
  ...over,
});

/** A service whose database holds one key (minted for real) owned by `user`. */
function keyed(
  opts: {
    user?: Partial<Owner>;
    scope?: 'contributor' | 'admin';
    revokedAt?: Date | null;
    allowedCidrs?: string[];
    lastUsedAt?: Date | null;
    policy?: MfaPolicy;
  } = {},
) {
  const minted = new ApiKeysService({} as PrismaService, noMfa).mint();
  const row = {
    id: 'k1',
    prefix: minted.prefix,
    hash: minted.hash,
    scope: opts.scope ?? 'contributor',
    revokedAt: opts.revokedAt ?? null,
    allowedCidrs: opts.allowedCidrs ?? [],
    lastUsedAt: opts.lastUsedAt ?? null,
    user: owner(opts.user),
  };
  const findUnique = jest.fn(async (args: { where: { prefix: string } }) =>
    args.where.prefix === row.prefix ? row : null,
  );
  const updateMany = jest.fn(async () => ({ count: 1 }));
  const prisma = {
    apiKey: { findUnique, updateMany },
  } as unknown as PrismaService;
  return {
    service: new ApiKeysService(prisma, opts.policy ?? noMfa),
    token: minted.token,
    findUnique,
    updateMany,
  };
}

/** A service for `create`, with `active` keys already on the owner's account. */
function creator(active = 0) {
  const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'k-new',
    createdAt: new Date('2026-10-15T00:00:00Z'),
    lastUsedAt: null,
    ...args.data,
  }));
  const count = jest.fn(async () => active);
  const prisma = { apiKey: { create, count } } as unknown as PrismaService;
  return { service: new ApiKeysService(prisma, noMfa), create };
}

const contributor = {
  id: 'u1',
  role: 'CONTRIBUTOR' as Role,
  emailVerified: true,
};

async function rejection(p: Promise<unknown>): Promise<HttpException> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  return err as HttpException;
}

describe('ApiKeysService.mint', () => {
  it('produces cbk_<8 base62>_<43 base64url>, with the prefix as its head', () => {
    const { prefix, token, hash } = new ApiKeysService({} as PrismaService, noMfa).mint();
    expect(token).toMatch(/^cbk_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(token.startsWith(`${prefix}_`)).toBe(true);
    expect(prefix).toHaveLength(12);
    expect(hash).toBe(sha256(token));
  });
});

describe('ApiKeysService.create', () => {
  it('stores only the hash and returns the token once', async () => {
    const { service, create } = creator();
    const result = await service.create(contributor, {
      name: ' laptop ',
      scope: 'contributor',
      allowedCidrs: ['203.0.113.7', '10.0.0.0/8', ''],
    });
    const data = create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data.hash).toBe(sha256(result.token));
    expect(Object.values(data)).not.toContain(result.token);
    expect(data.name).toBe('laptop');
    expect(data.allowedCidrs).toEqual(['203.0.113.7/32', '10.0.0.0/8']);
    expect(result.key).toMatchObject({
      prefix: data.prefix,
      scope: 'contributor',
    });
    expect(result.key).not.toHaveProperty('hash');
  });

  it('refuses a plain USER', async () => {
    const err = await rejection(
      creator().service.create(
        { ...contributor, role: 'USER' },
        { name: 'x', scope: 'contributor' },
      ),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  it('refuses an admin-scoped key to a contributor, allows it to an admin', async () => {
    const { service } = creator();
    const err = await rejection(service.create(contributor, { name: 'x', scope: 'admin' }));
    expect(err).toBeInstanceOf(ForbiddenException);
    await expect(
      service.create({ ...contributor, role: 'ADMIN' }, { name: 'x', scope: 'admin' }),
    ).resolves.toMatchObject({ key: { scope: 'admin' } });
  });

  it('refuses an unverified contributor with EMAIL_UNVERIFIED, but not an unverified admin', async () => {
    const { service } = creator();
    const err = await rejection(
      service.create({ ...contributor, emailVerified: false }, { name: 'x', scope: 'contributor' }),
    );
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toMatchObject({ code: EMAIL_UNVERIFIED });
    await expect(
      service.create(
        { ...contributor, role: 'ADMIN', emailVerified: false },
        { name: 'x', scope: 'contributor' },
      ),
    ).resolves.toBeDefined();
  });

  it(`refuses key number ${MAX_ACTIVE_API_KEYS + 1}`, async () => {
    const err = await rejection(
      creator(MAX_ACTIVE_API_KEYS).service.create(contributor, {
        name: 'x',
        scope: 'contributor',
      }),
    );
    expect(err).toBeInstanceOf(ConflictException);
  });

  it('rejects a bad CIDR, naming it', async () => {
    const err = await rejection(
      creator().service.create(contributor, {
        name: 'x',
        scope: 'contributor',
        allowedCidrs: ['10.0.0.0/8', '300.1.1.1/24'],
      }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).toContain('300.1.1.1/24');
  });
});

describe('ApiKeysService.authenticate', () => {
  it('accepts the token and resolves its owner with the key scope', async () => {
    const { service, token } = keyed();
    const auth = await service.authenticate(token, '203.0.113.1');
    expect(auth.user).toEqual({
      id: 'u1',
      email: 'u@test.dev',
      role: 'CONTRIBUTOR',
      emailVerified: true,
      apiKey: { id: 'k1', scope: 'contributor', prefix: auth.key.prefix },
    });
    expect(auth.key.scope).toBe('contributor');
  });

  it('rejects a one-character change to the secret', async () => {
    const { service, token } = keyed();
    const last = token.slice(-1);
    const tampered = token.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    expect(await rejection(service.authenticate(tampered, '203.0.113.1'))).toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a malformed token without a query', async () => {
    const { service, findUnique } = keyed();
    expect(await rejection(service.authenticate('cbk_short', '203.0.113.1'))).toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked', { revokedAt: new Date() }],
    ['owned by a banned user', { user: { bannedAt: new Date() } }],
    ['owned by a user demoted to USER', { user: { role: 'USER' as Role } }],
    ['admin-scoped, owned by a CONTRIBUTOR', { scope: 'admin' as const }],
  ])('answers 401 for a key %s', async (_label, opts) => {
    const { service, token } = keyed(opts);
    expect(await rejection(service.authenticate(token, '203.0.113.1'))).toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('answers 403 EMAIL_UNVERIFIED for an unverified contributor; an admin is exempt', async () => {
    const unverified = keyed({ user: { emailVerifiedAt: null } });
    const err = await rejection(unverified.service.authenticate(unverified.token, '203.0.113.1'));
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toMatchObject({ code: EMAIL_UNVERIFIED });

    const admin = keyed({
      user: { emailVerifiedAt: null, role: 'ADMIN' },
      scope: 'admin',
    });
    await expect(admin.service.authenticate(admin.token, '203.0.113.1')).resolves.toBeDefined();
  });

  it('answers 403 MFA_REQUIRED while a required role has no factor, without revoking', async () => {
    const without = keyed({ policy: mfaOn });
    const err = await rejection(without.service.authenticate(without.token, '203.0.113.1'));
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toMatchObject({ code: MFA_REQUIRED });

    const enrolled = keyed({ policy: mfaOn, user: { mfaEnabledAt: new Date() } });
    await expect(enrolled.service.authenticate(enrolled.token, '203.0.113.1')).resolves.toBeDefined();
    // Enforcement off: the same un-enrolled owner is fine.
    const off = keyed();
    await expect(off.service.authenticate(off.token, '203.0.113.1')).resolves.toBeDefined();
  });

  it('enforces the allowlist, including an IPv4-mapped socket address', async () => {
    const { service, token } = keyed({ allowedCidrs: ['203.0.113.0/24'] });
    await expect(service.authenticate(token, '203.0.113.9')).resolves.toBeDefined();
    await expect(service.authenticate(token, '::ffff:203.0.113.9')).resolves.toBeDefined();
    const err = await rejection(service.authenticate(token, '198.51.100.1'));
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  it('writes lastUsedAt at most once a minute', async () => {
    const fresh = keyed({ lastUsedAt: new Date(Date.now() - 10_000) });
    await fresh.service.authenticate(fresh.token, '203.0.113.1');
    expect(fresh.updateMany).not.toHaveBeenCalled();

    const stale = keyed({ lastUsedAt: new Date(Date.now() - 120_000) });
    await stale.service.authenticate(stale.token, '203.0.113.1');
    expect(stale.updateMany).toHaveBeenCalledTimes(1);

    const never = keyed();
    await never.service.authenticate(never.token, '203.0.113.1');
    expect(never.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('CIDR helpers', () => {
  it('parses v4, v6 and bare addresses, and refuses junk', () => {
    expect(parseCidr('10.0.0.0/8')).toEqual({
      address: '10.0.0.0',
      prefix: 8,
      family: 4,
    });
    expect(parseCidr('2001:db8::/32')).toEqual({
      address: '2001:db8::',
      prefix: 32,
      family: 6,
    });
    expect(parseCidr('203.0.113.7')).toEqual({
      address: '203.0.113.7',
      prefix: 32,
      family: 4,
    });
    expect(parseCidr('10.0.0.0/33')).toBeNull();
    expect(parseCidr('example.com')).toBeNull();
    expect(parseCidr('10.0.0.0/8/8')).toBeNull();
  });

  it('matches v4 and v6, and an empty list allows anything', () => {
    expect(ipAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(ipAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false);
    expect(ipAllowed('10.1.2.3', [])).toBe(true);
    expect(ipAllowed('::ffff:10.1.2.3', ['10.0.0.0/8'])).toBe(true);
  });
});

describe('ApiKeysService.revoke', () => {
  it("404s a key that isn't the caller's", async () => {
    const updateMany = jest.fn(async () => ({ count: 0 }));
    const service = new ApiKeysService(
      { apiKey: { updateMany } } as unknown as PrismaService,
      noMfa,
    );
    const err = await rejection(service.revoke('u1', 'someone-elses'));
    expect(err.getStatus()).toBe(404);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'someone-elses', userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
