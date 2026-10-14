import { describe, it, expect } from '@jest/globals';

import { deriveCountry, trailingSegment } from './derive-country';

describe('deriveCountry', () => {
  it.each([
    // SBIR awardees are US by statute, whatever the city reads like.
    ['SBIR', 'LONDON, Ohio', 'US'],
    ['SBIR', '', 'US'],
    ['SEC_EDGAR', 'LONDON, UNITED KINGDOM', 'GB'],
    ['SEC_EDGAR', 'LONDON, ONTARIO, CANADA', 'CA'],
    ['SEC_EDGAR', 'San Francisco, CALIFORNIA', 'US'],
    ['SEC_EDGAR', 'WASHINGTON, DISTRICT OF COLUMBIA', 'US'],
    ['SEC_EDGAR', 'Atlanta, GEORGIA', 'US'],
    // A filing with no description stored the raw code instead.
    ['SEC_EDGAR', 'London, X0', 'GB'],
    ['SEC_FORM_C', 'Austin, TX', 'US'],
    ['SEC_FORM_C', 'London, X0', 'GB'],
    ['WIKIDATA', 'London, United States', 'US'],
    ['WIKIDATA', "Shanghai, People's Republic of China", 'CN'],
    ['WIKIDATA', 'Kingdom of England', 'GB'],
    ['SEC_ADV', 'Austin, TX, United States', 'US'],
    ['SEC_ADV', 'Seoul, Korea, South', 'KR'],
    ['SEC_ADV', 'Nassau, Bahamas, The', 'BS'],
    ['SEC_ADV', 'Taipei, Taiwan,  Republic of China', 'TW'],
  ])('%s %p → %s', (source, hq, expected) => {
    expect(deriveCountry(source, hq)).toBe(expected);
  });

  it.each([
    ['WIKIDATA', 'Undisclosed'],
    ['WIKIDATA', 'San Francisco'],
    ['SEC_EDGAR', 'Undisclosed'],
    ['SEC_FORM_C', 'Somewhere, XX'],
    ['SEC_S1', 'London, United Kingdom'],
    [null, 'London, United Kingdom'],
  ])('%s %p → null', (source, hq) => {
    expect(deriveCountry(source, hq)).toBeNull();
  });
});

describe('trailingSegment', () => {
  it('returns the last comma-separated part', () => {
    expect(trailingSegment('Seoul, Korea, South')).toBe('South');
    expect(trailingSegment('Undisclosed')).toBe('Undisclosed');
    expect(trailingSegment(null)).toBe('');
  });
});
