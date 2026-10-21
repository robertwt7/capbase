import { describe, expect, it } from '@jest/globals';

import { mfaKey, open, seal } from './secret-box';

const key = Buffer.alloc(32, 9);

describe('secret box', () => {
  it('round-trips, with a fresh IV each time', () => {
    const a = seal('JBSWY3DPEHPK3PXP', key);
    const b = seal('JBSWY3DPEHPK3PXP', key);
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(a).not.toBe(b);
    expect(open(a, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('throws on a tampered tag, a tampered ciphertext or the wrong key', () => {
    const sealed = seal('secret', key);
    const [v, iv, tag, ct] = sealed.split('.') as [string, string, string, string];
    const flip = (s: string) => {
      const buf = Buffer.from(s, 'base64url');
      buf[0] = buf[0]! ^ 1;
      return buf.toString('base64url');
    };
    expect(() => open([v, iv, flip(tag), ct].join('.'), key)).toThrow();
    expect(() => open([v, iv, tag, flip(ct)].join('.'), key)).toThrow();
    expect(() => open(sealed, Buffer.alloc(32, 8))).toThrow();
    expect(() => open('v2.a.b.c', key)).toThrow(/Unrecognised/);
  });
});

describe('mfaKey', () => {
  it('uses MFA_ENCRYPTION_KEY when set', () => {
    expect(mfaKey({ MFA_ENCRYPTION_KEY: key.toString('base64') }).equals(key)).toBe(true);
  });

  it('derives a stable key from JWT_SECRET outside production', () => {
    const a = mfaKey({ JWT_SECRET: 'dev-secret' });
    expect(a).toHaveLength(32);
    expect(mfaKey({ JWT_SECRET: 'dev-secret' }).equals(a)).toBe(true);
    expect(mfaKey({ JWT_SECRET: 'other' }).equals(a)).toBe(false);
  });

  it('refuses to derive in production, and refuses a short key', () => {
    expect(() => mfaKey({ JWT_SECRET: 'x', NODE_ENV: 'production' })).toThrow(/required in production/);
    expect(() => mfaKey({ MFA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
      /32 bytes/,
    );
  });
});
