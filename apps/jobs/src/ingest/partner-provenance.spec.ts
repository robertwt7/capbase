import { describe, it, expect } from '@jest/globals';

import { equalFields, mergedMarks, sameStated } from './partner-provenance';

describe('sameStated', () => {
  it('matches BigInt money against the parser’s numbers', () => {
    expect(sameStated(430_428_863n, 430_428_863.4)).toBe(true);
    expect(sameStated(430_428_863n, 1)).toBe(false);
  });

  it('matches a Date column against a YYYY-MM-DD statement', () => {
    expect(sameStated(new Date('2019-06-30T00:00:00Z'), '2019-06-30')).toBe(true);
    expect(sameStated(new Date('2019-06-30T00:00:00Z'), '2019-07-01')).toBe(false);
  });

  it('never matches a column the partner said nothing about', () => {
    expect(sameStated(null, null)).toBe(false);
    expect(sameStated('Oslo, Norway', null)).toBe(false);
    expect(sameStated(null, 'Oslo, Norway')).toBe(false);
  });
});

describe('equalFields', () => {
  it('fails closed: a public value equal to the partner’s is marked too', () => {
    const row = { hq: 'Oslo, Norway', description: 'ADV prose', foundedYear: 2001 };
    const stated = { hq: 'Oslo, Norway', description: 'Partner prose', foundedYear: 2001 };
    expect(equalFields(row, stated, ['hq', 'description', 'foundedYear'])).toEqual(['hq', 'foundedYear']);
  });
});

describe('mergedMarks', () => {
  it('only ever adds, and is a no-op on a second pass', () => {
    expect(mergedMarks(['status'], ['status', 'hq'])).toEqual(['status', 'hq']);
    expect(mergedMarks(['status', 'hq'], ['hq'])).toBeNull();
    expect(mergedMarks(null, [])).toBeNull();
  });
});
