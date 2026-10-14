import {
  COUNTRY_CODES,
  countryCodeFromName,
  countryName,
  normalizeCountryCode,
} from './geography';

describe('COUNTRY_CODES', () => {
  it('holds the 249 officially assigned codes, once each', () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
  });
});

describe('normalizeCountryCode', () => {
  it('maps the EU institutions’ non-ISO codes', () => {
    expect(normalizeCountryCode('UK')).toBe('GB');
    expect(normalizeCountryCode('EL')).toBe('GR');
  });

  it('upper-cases and trims', () => {
    expect(normalizeCountryCode('gb')).toBe('GB');
    expect(normalizeCountryCode(' us ')).toBe('US');
  });

  it('rejects anything unassigned', () => {
    expect(normalizeCountryCode('XX')).toBeNull();
    expect(normalizeCountryCode('XK')).toBeNull();
    expect(normalizeCountryCode('GBR')).toBeNull();
    expect(normalizeCountryCode('')).toBeNull();
    expect(normalizeCountryCode(null)).toBeNull();
    expect(normalizeCountryCode(undefined)).toBeNull();
  });
});

describe('countryCodeFromName', () => {
  it('reads the United Kingdom in every spelling our sources use', () => {
    for (const name of ['United Kingdom', 'UNITED KINGDOM', 'England', 'Scotland', 'Kingdom of England']) {
      expect(countryCodeFromName(name)).toBe('GB');
    }
  });

  it('reads long official and Wikidata-style forms', () => {
    expect(countryCodeFromName("People's Republic of China")).toBe('CN');
    expect(countryCodeFromName('People’s Republic of China')).toBe('CN');
    expect(countryCodeFromName('Czech Republic')).toBe('CZ');
    expect(countryCodeFromName('Russian Federation')).toBe('RU');
    expect(countryCodeFromName('Bosnia and Herzegovina')).toBe('BA');
  });

  it('reads the United States', () => {
    expect(countryCodeFromName('United States')).toBe('US');
    expect(countryCodeFromName('UNITED STATES')).toBe('US');
    expect(countryCodeFromName('United States of America')).toBe('US');
  });

  it('reads the SEC’s inverted "Name, Qualifier" style', () => {
    expect(countryCodeFromName('Korea, South')).toBe('KR');
    expect(countryCodeFromName('Bahamas, The')).toBe('BS');
    expect(countryCodeFromName('Taiwan,  Republic of China')).toBe('TW');
    expect(countryCodeFromName('Georgia/Gruzinskaya')).toBe('GE');
  });

  it('reads Intl labels with and without their qualifier', () => {
    expect(countryCodeFromName('Hong Kong')).toBe('HK');
    expect(countryCodeFromName('Hong Kong SAR China')).toBe('HK');
    expect(countryCodeFromName('Côte d’Ivoire')).toBe('CI');
  });

  it('never guesses from a place that is not a country', () => {
    expect(countryCodeFromName('Ohio')).toBeNull();
    expect(countryCodeFromName('San Francisco')).toBeNull();
    expect(countryCodeFromName('Austrian Empire')).toBeNull();
    expect(countryCodeFromName('Undisclosed')).toBeNull();
    expect(countryCodeFromName('')).toBeNull();
    expect(countryCodeFromName(null)).toBeNull();
  });
});

describe('countryName', () => {
  it('names an assigned code', () => {
    expect(countryName('GB')).toBe('United Kingdom');
    expect(countryName('us')).toBe('United States');
  });

  it('is null-safe', () => {
    expect(countryName(null)).toBeNull();
    expect(countryName('ZZ')).toBeNull();
  });
});
