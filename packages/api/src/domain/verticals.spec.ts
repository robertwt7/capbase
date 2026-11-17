import { SECTORS } from './company';
import {
  isVertical,
  labelSlug,
  VERTICAL_SECTOR,
  verticalFromSlug,
  VERTICALS,
  verticalsOf,
} from './verticals';

// The web's `sectorSlug` as it stood before it became `labelSlug`: the two must agree, or
// every existing /markets/<sector> URL would move.
const legacySectorSlug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

describe('VERTICALS', () => {
  it('holds 84 verticals', () => {
    expect(VERTICALS).toHaveLength(84);
  });

  it('slugs are unique and round-trip', () => {
    const slugs = VERTICALS.map(labelSlug);
    expect(new Set(slugs).size).toBe(VERTICALS.length);
    for (const v of VERTICALS) expect(verticalFromSlug(labelSlug(v))).toBe(v);
    expect(verticalFromSlug('oil-gas')).toBe('Oil & gas');
    expect(verticalFromSlug('nope')).toBeUndefined();
  });

  it('labelSlug equals the web sectorSlug for every sector', () => {
    for (const s of SECTORS) expect(labelSlug(s)).toBe(legacySectorSlug(s));
  });

  it('verticalsOf lists a sector’s verticals; three sectors have none', () => {
    expect(verticalsOf('Education')).toEqual([
      'Schools',
      'Higher education',
      'Training & tutoring',
      'Edtech',
    ]);
    expect(verticalsOf('Artificial intelligence')).toEqual([]);
    expect(verticalsOf('Enterprise SaaS')).toEqual([]);
    expect(verticalsOf('Fintech')).toEqual([]);
    expect(SECTORS.flatMap(verticalsOf)).toHaveLength(VERTICALS.length);
  });

  it('isVertical accepts only the vocabulary', () => {
    expect(isVertical('Banking')).toBe(true);
    expect(isVertical('banking')).toBe(false);
    expect(isVertical('toString')).toBe(false);
    expect(Object.keys(VERTICAL_SECTOR)).toEqual(VERTICALS);
  });
});
