import { randomInt } from 'node:crypto';

import { RECOVERY_CODE_COUNT } from '@repo/api';

/** 32 characters with no 0/O or 1/I look-alikes: 5 bits each, 50 bits a code. */
const ALPHABET = 'abcdefghjklmnpqrstuvwxyz23456789';
const HALF = 5;

/**
 * Fresh plaintext recovery codes, `xxxxx-xxxxx`. Stored as sha256 (`hashToken`) of the
 * normalised form: 50 bits each plus the per-challenge and per-account attempt caps make a
 * slow hash unnecessary.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let raw = '';
    for (let i = 0; i < HALF * 2; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
    codes.add(`${raw.slice(0, HALF)}-${raw.slice(HALF)}`);
  }
  return [...codes];
}

/** What the user typed → the form that was hashed: lowercase, no spaces or dashes. */
export function normalizeRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[\s-]/g, '');
}
