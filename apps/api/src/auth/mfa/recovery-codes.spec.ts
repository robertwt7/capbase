import { describe, expect, it } from '@jest/globals';
import { RECOVERY_CODE_COUNT } from '@repo/api';

import { generateRecoveryCodes, normalizeRecoveryCode } from './recovery-codes';

describe('recovery codes', () => {
  it('generates RECOVERY_CODE_COUNT distinct xxxxx-xxxxx codes without look-alikes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
      expect(code).not.toMatch(/[01io]/);
    }
  });

  it('normalises case, spaces and dashes', () => {
    expect(normalizeRecoveryCode('ABCDE-23456')).toBe('abcde23456');
    expect(normalizeRecoveryCode(' abcde 23456 ')).toBe('abcde23456');
  });
});
