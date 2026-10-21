import { describe, expect, it } from '@jest/globals';

import { validateEnv } from './env';

const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'change-me-in-production' };

describe('validateEnv', () => {
  it('accepts the .env.example placeholder outside production', () => {
    expect(validateEnv(base)).toBe(base);
  });

  it('rejects a missing DATABASE_URL and JWT_SECRET together', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL is required[\s\S]*JWT_SECRET is required/);
  });

  it('rejects a short secret in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', JWT_SECRET: 'short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('accepts a strong secret in production', () => {
    const env = {
      ...base,
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(48),
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    };
    expect(validateEnv(env)).toBe(env);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow(/PORT must be a number/);
  });

  it('accepts a well-formed SENTRY_DSN and rejects a malformed one', () => {
    const ok = { ...base, SENTRY_DSN: 'https://abc123@errors.capbase.fyi/2' };
    expect(validateEnv(ok)).toBe(ok);
    expect(() => validateEnv({ ...base, SENTRY_DSN: 'errors.capbase.fyi' })).toThrow(/SENTRY_DSN/);
  });

  it('rejects a non-numeric QUEUE_ALERT_THRESHOLD', () => {
    expect(validateEnv({ ...base, QUEUE_ALERT_THRESHOLD: '0' })).toBeTruthy();
    expect(() => validateEnv({ ...base, QUEUE_ALERT_THRESHOLD: 'lots' })).toThrow(
      /QUEUE_ALERT_THRESHOLD/,
    );
  });

  it('rejects a digest schedule or timezone the cron would choke on', () => {
    const ok = { ...base, QUEUE_DIGEST_CRON: '30 7 * * 1-5', QUEUE_DIGEST_TZ: 'Australia/Sydney' };
    expect(validateEnv(ok)).toBe(ok);
    expect(() => validateEnv({ ...base, QUEUE_DIGEST_CRON: 'daily' })).toThrow(/QUEUE_DIGEST_CRON/);
    expect(() => validateEnv({ ...base, QUEUE_DIGEST_TZ: 'Mars/Olympus' })).toThrow(
      /QUEUE_DIGEST_TZ/,
    );
  });

  it('accepts a TRUST_PROXY list and rejects one that would trust every hop', () => {
    const ok = { ...base, TRUST_PROXY: 'loopback, 10.0.0.0/8, fd00::/8' };
    expect(validateEnv(ok)).toBe(ok);
    for (const bad of ['true', '1', 'everyone']) {
      expect(() => validateEnv({ ...base, TRUST_PROXY: bad })).toThrow(/TRUST_PROXY/);
    }
  });

  describe('MFA', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const prod = { ...base, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(48) };

    it('requires MFA_ENCRYPTION_KEY in production only', () => {
      expect(() => validateEnv(prod)).toThrow(/MFA_ENCRYPTION_KEY is required/);
      expect(validateEnv({ ...prod, MFA_ENCRYPTION_KEY: key })).toBeTruthy();
      expect(validateEnv(base)).toBe(base);
    });

    it('rejects a key that is not 32 bytes', () => {
      const short = Buffer.alloc(16).toString('base64');
      expect(() => validateEnv({ ...prod, MFA_ENCRYPTION_KEY: short })).toThrow(/exactly 32 bytes/);
      expect(() => validateEnv({ ...base, MFA_ENCRYPTION_KEY: 'nope' })).toThrow(/exactly 32 bytes/);
    });

    it('accepts a role list, an empty list, and rejects an unknown role', () => {
      expect(validateEnv({ ...base, MFA_REQUIRED_ROLES: 'ADMIN, CONTRIBUTOR' })).toBeTruthy();
      expect(validateEnv({ ...base, MFA_REQUIRED_ROLES: '' })).toBeTruthy();
      expect(() => validateEnv({ ...base, MFA_REQUIRED_ROLES: 'ADMIN,MODERATOR' })).toThrow(
        /MFA_REQUIRED_ROLES/,
      );
    });

    it('rejects a WEBAUTHN_RP_ID with a scheme', () => {
      expect(validateEnv({ ...base, WEBAUTHN_RP_ID: 'capbase.fyi' })).toBeTruthy();
      expect(() => validateEnv({ ...base, WEBAUTHN_RP_ID: 'https://capbase.fyi' })).toThrow(
        /WEBAUTHN_RP_ID/,
      );
    });
  });
});
