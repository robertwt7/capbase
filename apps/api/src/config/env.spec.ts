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
    const env = { ...base, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(48) };
    expect(validateEnv(env)).toBe(env);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow(/PORT must be a number/);
  });
});
