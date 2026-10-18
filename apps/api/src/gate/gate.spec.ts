import { describe, it, expect } from '@jest/globals';
import type { ViewerAccess } from '@repo/api';

import { COMPANY_BLANKS, maskFields, maskPartnerFields, publicRowsWhere, rowVisible, stubFor } from './gate';
import { lockedHistoryWhere } from './history';

const signedOut: ViewerAccess = { unlocked: false, signedIn: false, unlockedUntil: null };
const locked: ViewerAccess = { unlocked: false, signedIn: true, unlockedUntil: null };
const unlocked: ViewerAccess = { unlocked: true, signedIn: true, unlockedUntil: null };

const company = {
  slug: 'acme',
  description: 'The partner wrote this.',
  totalRaisedUsd: 9_000_000,
  lastValuationUsd: 40_000_000,
  industry: ['Software'],
  hq: 'Oslo',
};

describe('maskPartnerFields', () => {
  it('blanks partner fields for a signed-out viewer and lists them in `masked`', () => {
    const out = maskPartnerFields(
      company,
      ['description', 'totalRaisedUsd', 'lastValuationUsd', 'industry', 'notOnTheEntity'],
      signedOut,
      COMPANY_BLANKS,
    );
    expect(out).toMatchObject({ description: '', totalRaisedUsd: 0, lastValuationUsd: null, industry: [], hq: 'Oslo' });
    expect((out as { masked?: string[] }).masked?.sort()).toEqual(
      ['description', 'industry', 'lastValuationUsd', 'totalRaisedUsd'],
    );
    // The input is never mutated.
    expect(company.description).toBe('The partner wrote this.');
  });

  it.each([
    ['signed in, locked', locked],
    ['unlocked', unlocked],
  ])('is a no-op for a %s viewer', (_label, access) => {
    expect(maskPartnerFields(company, ['description'], access, COMPANY_BLANKS)).toBe(company);
  });

  it('merges into an existing masked list', () => {
    const out = maskFields({ a: 1, b: 2, masked: ['a'] }, ['b']);
    expect(out).toEqual({ a: 1, b: null, masked: ['a', 'b'] });
  });
});

describe('publicRowsWhere', () => {
  it('keeps NULL-source rows (contributions) while dropping partner rows', () => {
    expect(publicRowsWhere(signedOut)).toEqual({
      OR: [{ externalSource: null }, { externalSource: { not: 'PARTNER' } }],
    });
  });

  it('filters nothing once partner data is visible', () => {
    expect(publicRowsWhere(locked)).toEqual({});
    expect(publicRowsWhere(unlocked)).toEqual({});
  });

  it('agrees with the in-memory check', () => {
    expect(rowVisible({ externalSource: null }, signedOut)).toBe(true);
    expect(rowVisible({ externalSource: 'SEC_EDGAR' }, signedOut)).toBe(true);
    expect(rowVisible({ externalSource: 'PARTNER' }, signedOut)).toBe(false);
    expect(rowVisible({ externalSource: 'PARTNER' }, locked)).toBe(true);
  });
});

describe('stubFor', () => {
  it('stubs a partner-only entity for signed-out viewers only', () => {
    expect(stubFor(true, signedOut)).toBe(true);
    expect(stubFor(true, locked)).toBe(false);
    expect(stubFor(false, signedOut)).toBe(false);
  });
});

describe('lockedHistoryWhere', () => {
  it('allows only company-field entries from admins and public sources, minus partner-touched fields', () => {
    expect(lockedHistoryWhere('c1', ['description', 'totalRaisedUsd'])).toEqual({
      companyId: 'c1',
      entityType: 'company',
      field: { notIn: ['description', 'totalRaisedUsd'] },
      OR: [
        { actor: 'ADMIN' },
        {
          actor: 'INGEST',
          actorSource: {
            in: ['SEC_EDGAR', 'SEC_ADV', 'SEC_ADV_FUNDS', 'SEC_FORM_C', 'SBIR', 'SEC_S1', 'INNOVATE_UK', 'COMPANIES_HOUSE', 'WIKIDATA'],
          },
        },
      ],
    });
  });

  it('adds no field filter when the partner never touched the company', () => {
    expect(lockedHistoryWhere('c1', [])).not.toHaveProperty('field');
  });
});
