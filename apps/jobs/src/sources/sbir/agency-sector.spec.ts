import { describe, it, expect } from '@jest/globals';

import { AGENCY_SECTOR_MAP, agencySector, agencyShort } from './agency-sector';

describe('agencySector', () => {
  it('maps a single-mission agency to its sector', () => {
    expect(agencySector('Department of Health and Human Services')).toBe('Healthcare');
    expect(agencySector('Department of Energy')).toBe('Energy');
    expect(agencySector('Environmental Protection Agency')).toBe('Climate');
    expect(agencySector('National Aeronautics and Space Administration')).toBe('Industrials');
  });

  it('is null for the agencies that fund every sector', () => {
    // Stamping every DoD or NSF award with one sector would be a lie at scale;
    // the award titles decide for these.
    expect(agencySector('Department of Defense')).toBeNull();
    expect(agencySector('National Science Foundation')).toBeNull();
    expect(agencySector('Department of Commerce')).toBeNull();
  });

  it('is null for an agency it has never seen', () => {
    expect(agencySector('Ministry of Silly Walks')).toBeNull();
    expect(agencySector(undefined)).toBeNull();
  });

  it('covers every agency in the map with a valid value', () => {
    expect(Object.keys(AGENCY_SECTOR_MAP).length).toBeGreaterThan(10);
  });
});

describe('agencyShort', () => {
  it('abbreviates the agencies a funding ladder has to fit', () => {
    expect(agencyShort('National Aeronautics and Space Administration')).toBe('NASA');
    expect(agencyShort('Department of Defense')).toBe('DOD');
  });

  it('passes an unknown agency through unchanged', () => {
    expect(agencyShort('Ministry of Silly Walks')).toBe('Ministry of Silly Walks');
    expect(agencyShort(undefined)).toBe('');
  });
});
