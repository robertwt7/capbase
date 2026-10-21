import { createHmac, randomBytes } from 'node:crypto';

/**
 * TOTP (RFC 6238) on node:crypto: HMAC-SHA1, 6 digits, 30-second steps — the defaults every
 * authenticator app assumes, so the otpauth URI carries no algorithm/digits/period overrides.
 */
export const TOTP_PERIOD_SECONDS = 30;
/** Steps either side of now that still verify, for clock drift and slow typing. */
export const TOTP_WINDOW = 1;
const SECRET_BYTES = 20;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, unpadded (what authenticator apps expect in an otpauth URI). */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Decode base32, ignoring case, spaces and padding. Throws on any other character. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character "${char}"`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, base32 (RFC 4226 recommends the HMAC-SHA1 block's 160 bits). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** The time step `now` falls in. */
export function totpStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
}

/** The 6-digit code for one time step. */
export function totpAt(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return bin.toString().padStart(6, '0');
}

/**
 * The step `code` matches within ±TOTP_WINDOW of `now`, or null. A step at or below
 * `lastStep` (the last one this account accepted) is a replay and never matches, so one code
 * can't sign in twice even inside its 90-second window.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  now: number,
  lastStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(now);
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    if (lastStep !== null && step <= lastStep) continue;
    if (totpAt(secretBase32, step) === code) return step;
  }
  return null;
}

/** The `otpauth://` URI an authenticator app scans. Shown as "Capbase (email)". */
export function otpauthUri({
  issuer,
  account,
  secret,
}: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret, issuer });
  return `otpauth://totp/${label}?${params.toString()}`;
}
