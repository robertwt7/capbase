import { describe, it, expect } from '@jest/globals';

import { countryFromEdgarCode, countryFromEdgarDescription } from './edgar-locations';

describe('countryFromEdgarCode', () => {
  it.each([
    ['CA', 'US'],
    ['NY', 'US'],
    ['DC', 'US'],
    ['X1', 'US'],
    ['A6', 'CA'],
    ['Z4', 'CA'],
    ['X0', 'GB'],
    ['F4', 'CN'],
    ['K3', 'HK'],
    ['L2', 'IE'],
    ['2M', 'DE'],
    ['M5', 'KR'],
    ['PR', 'PR'],
    ['x0', 'GB'],
  ])('%s → %s', (code, iso) => {
    expect(countryFromEdgarCode(code)).toBe(iso);
  });

  it('is null for EDGAR’s unknown, a dissolved territory, and junk', () => {
    expect(countryFromEdgarCode('XX')).toBeNull();
    expect(countryFromEdgarCode('P8')).toBeNull();
    expect(countryFromEdgarCode('ZZ')).toBeNull();
    expect(countryFromEdgarCode('')).toBeNull();
    expect(countryFromEdgarCode(null)).toBeNull();
  });
});

describe('countryFromEdgarDescription', () => {
  it.each([
    ['UNITED KINGDOM', 'GB'],
    ['CALIFORNIA', 'US'],
    ['ONTARIO, CANADA', 'CA'],
    ['CANADA', 'CA'],
    ['CANADA (FEDERAL LEVEL)', 'CA'],
    ['united kingdom', 'GB'],
    ['KOREA, REPUBLIC OF', 'KR'],
    ['VIRGIN ISLANDS, BRITISH', 'VG'],
  ])('%s → %s', (description, iso) => {
    expect(countryFromEdgarDescription(description)).toBe(iso);
  });

  it('reads GEORGIA as the US state, which is the overwhelmingly likelier filer', () => {
    expect(countryFromEdgarDescription('GEORGIA')).toBe('US');
    // The code lookup has no such ambiguity.
    expect(countryFromEdgarCode('2Q')).toBe('GE');
  });

  it('is null for anything that is not an EDGAR description', () => {
    expect(countryFromEdgarDescription('Ohio, USA')).toBeNull();
    expect(countryFromEdgarDescription('UNKNOWN')).toBeNull();
  });
});
