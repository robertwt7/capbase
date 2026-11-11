import { describe, expect, it } from '@jest/globals';

import { claimEndReason, claimStatus, isActiveClaim } from './active-claim';

const now = new Date('2026-11-12T00:00:00Z');
const emailClaim = {
  method: 'EMAIL',
  domain: 'acme.com',
  verifiedAt: now,
  revokedAt: null as Date | null,
  user: { bannedAt: null as Date | null },
  endReason: null as string | null,
};
const company = { domain: 'acme.com', mergedIntoId: null as string | null };

describe('isActiveClaim', () => {
  it('is active when verified, live and on the same domain', () => {
    expect(isActiveClaim(emailClaim, company)).toBe(true);
    expect(isActiveClaim(emailClaim, { ...company, domain: 'https://www.Acme.com/' })).toBe(true);
  });

  it.each([
    ['unverified', { ...emailClaim, verifiedAt: null }, company],
    ['revoked', { ...emailClaim, revokedAt: now }, company],
    ['banned', { ...emailClaim, user: { bannedAt: now } }, company],
    ['company merged away', emailClaim, { ...company, mergedIntoId: 'x' }],
    ['company domain changed', emailClaim, { ...company, domain: 'acme.io' }],
    ['company domain cleared', emailClaim, { ...company, domain: '' }],
  ])('is inactive when %s', (_, claim, co) => {
    expect(isActiveClaim(claim, co)).toBe(false);
  });

  it('keeps a MANUAL claim active when the domain changes', () => {
    const manual = { ...emailClaim, method: 'MANUAL', domain: '' };
    expect(isActiveClaim(manual, { ...company, domain: 'acme.io' })).toBe(true);
    expect(isActiveClaim({ ...manual, verifiedAt: null }, company)).toBe(false);
  });
});

describe('claimStatus', () => {
  it('derives each status', () => {
    expect(claimStatus(emailClaim, company)).toBe('active');
    expect(claimStatus(emailClaim, { ...company, domain: 'acme.io' })).toBe('suspended');
    expect(claimStatus({ ...emailClaim, method: 'MANUAL', verifiedAt: null }, company)).toBe('pending');
    expect(claimStatus({ ...emailClaim, revokedAt: now }, company)).toBe('ended');
    expect(claimStatus({ ...emailClaim, user: { bannedAt: now } }, company)).toBe('ended');
  });

  it('reports why a claim ended', () => {
    expect(claimEndReason({ ...emailClaim, endReason: 'revoked' })).toBe('revoked');
    expect(claimEndReason({ ...emailClaim, user: { bannedAt: now } })).toBe('ban');
    expect(claimEndReason(emailClaim)).toBeNull();
  });
});
