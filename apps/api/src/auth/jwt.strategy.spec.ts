import { describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { UsersService } from '../users/users.service';
import { JwtStrategy } from './jwt.strategy';
import { MfaPolicy } from './mfa/policy';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'c@test.dev',
  role: 'CONTRIBUTOR',
  tokenVersion: 0,
  bannedAt: null,
  emailVerifiedAt: new Date(),
  mfaEnabledAt: null,
  ...over,
});

function strategy(user: ReturnType<typeof row>, requiredRoles?: string) {
  const config = new ConfigService({
    JWT_SECRET: 'test',
    ...(requiredRoles !== undefined && { MFA_REQUIRED_ROLES: requiredRoles }),
  });
  const users = { findById: jest.fn(async () => user) } as unknown as UsersService;
  return new JwtStrategy(config, users, new MfaPolicy(config));
}

const payload = { sub: 'u1', email: 'c@test.dev', role: 'CONTRIBUTOR' as const, tv: 0 };

describe('JwtStrategy.validate', () => {
  it('rejects a required role with no second factor', async () => {
    await expect(strategy(row(), 'ADMIN,CONTRIBUTOR').validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts the same user once enrolled, or when enforcement is off', async () => {
    await expect(
      strategy(row({ mfaEnabledAt: new Date() }), 'ADMIN,CONTRIBUTOR').validate(payload),
    ).resolves.toMatchObject({ id: 'u1', role: 'CONTRIBUTOR' });
    await expect(strategy(row()).validate(payload)).resolves.toMatchObject({ id: 'u1' });
  });

  it('accepts a USER without a factor under enforcement', async () => {
    await expect(
      strategy(row({ role: 'USER' }), 'ADMIN,CONTRIBUTOR').validate(payload),
    ).resolves.toMatchObject({ role: 'USER' });
  });

  it('still rejects a stale tokenVersion', async () => {
    await expect(strategy(row({ tokenVersion: 1 })).validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
