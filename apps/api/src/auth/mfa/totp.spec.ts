import { describe, expect, it } from '@jest/globals';

import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpAt,
  totpStep,
  verifyTotp,
} from './totp';

// RFC 6238 appendix B: the SHA-1 seed is the ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const at = (seconds: number) => seconds * 1000;

describe('base32', () => {
  it('matches the RFC 4648 test vectors (unpadded)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
  });

  it('round-trips random secrets and ignores case, spaces and padding', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(base32Decode('mzxw 6ytb oi======').toString()).toBe('foobar');
  });

  it('rejects a character outside the alphabet', () => {
    expect(() => base32Decode('MZXW1')).toThrow(/Invalid base32/);
  });
});

describe('totpAt', () => {
  it('matches the RFC 6238 SHA-1 vectors (6-digit truncation)', () => {
    expect(totpAt(RFC_SECRET, totpStep(at(59)))).toBe('287082'); // 94287082
    expect(totpAt(RFC_SECRET, totpStep(at(1111111109)))).toBe('081804'); // 07081804
    expect(totpAt(RFC_SECRET, totpStep(at(1234567890)))).toBe('005924'); // 89005924
    expect(totpAt(RFC_SECRET, totpStep(at(2000000000)))).toBe('279037'); // 69279037
  });
});

describe('verifyTotp', () => {
  const now = at(1111111109);
  const step = totpStep(now);

  it('accepts the current step and one either side, not two', () => {
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step), now, null)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2), now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 2), now, null)).toBeNull();
  });

  it('rejects a replay: a step at or below the last accepted one', () => {
    const code = totpAt(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, now, step + 1)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, now, step - 1)).toBe(step);
  });

  it('rejects anything that is not six digits', () => {
    expect(verifyTotp(RFC_SECRET, '12345', now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now, null)).toBeNull();
  });
});

describe('otpauthUri', () => {
  it('labels the account "Capbase:email" with the issuer and secret', () => {
    const uri = otpauthUri({ issuer: 'Capbase', account: 'ada@example.com', secret: 'ABC' });
    expect(uri).toBe('otpauth://totp/Capbase:ada%40example.com?secret=ABC&issuer=Capbase');
  });
});
