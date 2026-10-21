import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { MfaPolicy, mfaRequiredRoles, parseMfaRoles } from './policy';

describe('mfaRequiredRoles', () => {
  it('defaults to ADMIN + CONTRIBUTOR in production and none elsewhere', () => {
    expect(mfaRequiredRoles({ NODE_ENV: 'production' })).toEqual(['ADMIN', 'CONTRIBUTOR']);
    expect(mfaRequiredRoles({ NODE_ENV: 'development' })).toEqual([]);
    expect(mfaRequiredRoles({})).toEqual([]);
  });

  it('takes an explicit list, including an explicit empty one in production', () => {
    expect(mfaRequiredRoles({ NODE_ENV: 'production', MFA_REQUIRED_ROLES: '' })).toEqual([]);
    expect(mfaRequiredRoles({ MFA_REQUIRED_ROLES: 'ADMIN' })).toEqual(['ADMIN']);
  });

  it('parses a comma list and rejects an unknown role', () => {
    expect(parseMfaRoles(' ADMIN , CONTRIBUTOR ')).toEqual(['ADMIN', 'CONTRIBUTOR']);
    expect(parseMfaRoles('ADMIN,ROOT')).toBeNull();
  });
});

describe('MfaPolicy', () => {
  const policy = (env: Record<string, string>) =>
    new MfaPolicy(new ConfigService(env));

  it('is unmet only for a required role with no factor', () => {
    const p = policy({ MFA_REQUIRED_ROLES: 'ADMIN,CONTRIBUTOR' });
    expect(p.unmet({ role: 'CONTRIBUTOR', mfaEnabledAt: null })).toBe(true);
    expect(p.unmet({ role: 'CONTRIBUTOR', mfaEnabledAt: new Date() })).toBe(false);
    expect(p.unmet({ role: 'USER', mfaEnabledAt: null })).toBe(false);
    expect(policy({}).unmet({ role: 'ADMIN', mfaEnabledAt: null })).toBe(false);
  });
});
