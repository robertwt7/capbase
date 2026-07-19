import { describe, expect, it } from '@jest/globals';

import { SEC_SECTOR_MAP, secSector } from './sector-map';

describe('secSector', () => {
  it.each([
    ['Biotechnology', 'Healthcare'],
    ['Pharmaceuticals', 'Healthcare'],
    ['Other Technology', 'Technology'],
    ['Computers', 'Technology'],
    ['Commercial Banking', 'Financial services'],
    ['Pooled Investment Fund', 'Financial services'],
    ['Oil and Gas', 'Energy'],
    ['Environmental Services', 'Climate'],
    ['REITS and Finance', 'Real estate'],
    ['Residential', 'Real estate'],
    ['Manufacturing', 'Industrials'],
    ['Agriculture', 'Industrials'],
    ['Retailing', 'Consumer & retail'],
    ['Tourism and Travel Services', 'Consumer & retail'],
    ['Airlines and Airports', 'Transport'],
    ['Telecommunications', 'Media & telecom'],
  ])('%s → %s', (industry, expected) => {
    expect(secSector(industry)).toBe(expected);
  });

  it('leaves signal-free industries unclassified', () => {
    expect(secSector('Other')).toBeNull();
    expect(secSector('Business Services')).toBeNull();
  });

  it('returns null for unknown or empty values', () => {
    expect(secSector('Underwater Basket Weaving')).toBeNull();
    expect(secSector('')).toBeNull();
  });

  it('maps every enumerated Form D industry to a Sector or an explicit null', () => {
    for (const value of Object.values(SEC_SECTOR_MAP)) {
      expect(value === null || typeof value === 'string').toBe(true);
    }
    // The Form D taxonomy is fixed — a shrinking map means values went missing.
    expect(Object.keys(SEC_SECTOR_MAP).length).toBeGreaterThanOrEqual(35);
  });
});
