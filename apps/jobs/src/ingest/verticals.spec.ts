import { describe, expect, it, jest } from '@jest/globals';

import { PARTNER_SECTOR_MAP } from '../sources/partner/partner.parser';
import { SEC_SECTOR_MAP } from '../sources/sec-edgar/sector-map';
import { FORM_D_VERTICALS, PARTNER_VERTICALS } from '@repo/api/domain/vertical-map';
import { humanVerticalCompanyIds, planVerticals } from './verticals';

const row = (
  o: Partial<{ verticals: string[]; industry: string[]; partnerFields: string[] }> = {},
) => ({ verticals: [], industry: [], partnerFields: [], ...o });

describe('planVerticals', () => {
  it('is null when the row already holds its derivation (idempotence)', () => {
    expect(planVerticals(row({ industry: ['Banks'], verticals: ['Banking'] }), false)).toBeNull();
    expect(
      planVerticals(
        row({
          industry: ['Software'],
          verticals: ['Software'],
          partnerFields: ['industry', 'verticals'],
        }),
        true,
      ),
    ).toBeNull();
    expect(planVerticals(row({ industry: ['Department of Defense'] }), false)).toBeNull();
  });

  it('derives verticals and adds the mark for a partner-marked industry', () => {
    expect(
      planVerticals(row({ industry: ['Software'], partnerFields: ['industry'] }), true),
    ).toEqual({ verticals: ['Software'], partnerFields: ['industry', 'verticals'] });
  });

  it('removes a stale mark from verticals derived from a public industry', () => {
    expect(
      planVerticals(
        row({ industry: ['Banks'], verticals: ['Banking'], partnerFields: ['hq', 'verticals'] }),
        false,
      ),
    ).toEqual({ verticals: ['Banking'], partnerFields: ['hq'] });
  });

  it('labels that no longer map clear the verticals and the mark', () => {
    expect(
      planVerticals(
        row({
          industry: ['Financial Services'],
          verticals: ['Software'],
          partnerFields: ['industry', 'verticals'],
        }),
        true,
      ),
    ).toEqual({ verticals: [], partnerFields: ['industry'] });
  });

  it('leaves the marks alone when only the verticals move', () => {
    expect(
      planVerticals(row({ industry: ['Banks', 'Life insurance'], verticals: ['Banking'] }), false),
    ).toEqual({ verticals: ['Banking', 'Insurance'] });
  });
});

describe('humanVerticalCompanyIds', () => {
  it('returns the ids the approved-proposal query yields', async () => {
    const db = { $queryRaw: jest.fn(async () => [{ companyId: 'a' }, { companyId: 'b' }]) };
    expect(await humanVerticalCompanyIds(db as never)).toEqual(new Set(['a', 'b']));
  });
});

describe('vertical tables cover the source vocabularies', () => {
  it('every partner primary industry is reviewed', () => {
    expect(Object.keys(PARTNER_VERTICALS).sort()).toEqual(Object.keys(PARTNER_SECTOR_MAP).sort());
  });

  it('every Form D industry group is reviewed', () => {
    expect(Object.keys(FORM_D_VERTICALS).sort()).toEqual(Object.keys(SEC_SECTOR_MAP).sort());
  });
});
