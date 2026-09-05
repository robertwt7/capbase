import { describe, it, expect } from '@jest/globals';

import { normalizeName } from './ingest.service';
import { detectorNameKey, sweep, type DetectRow } from './merge-detector';

const row = (id: string, name: string, domain: string | null = null): DetectRow => ({
  id,
  name,
  domain,
});

const byDomain = (r: DetectRow) => r.domain ?? '';

describe('sweep', () => {
  it('emits one pair for a group of exactly two', () => {
    const { pairs } = sweep([row('a', 'A', 'acme.com'), row('b', 'B', 'acme.com')], byDomain, 8);
    expect(pairs).toEqual([{ aId: 'a', bId: 'b', evidence: 'acme.com' }]);
  });

  it('emits all three pairs for a group of three', () => {
    const { pairs } = sweep(
      [row('a', 'A', 'acme.com'), row('b', 'B', 'acme.com'), row('c', 'C', 'acme.com')],
      byDomain,
      8,
    );
    expect(pairs.map((p) => `${p.aId}${p.bId}`).sort()).toEqual(['ab', 'ac', 'bc']);
  });

  it('emits nothing for a singleton', () => {
    expect(sweep([row('a', 'A', 'acme.com')], byDomain, 8).pairs).toEqual([]);
  });

  it('skips a group over the threshold instead of flooding the queue', () => {
    // 20 rows sharing a key would be 190 pairs. A key that generic is a generic
    // string, not 190 duplicates.
    const rows = Array.from({ length: 20 }, (_, i) => row(`r${i}`, 'Holdings', 'shared.com'));
    const { pairs, skipped } = sweep(rows, byDomain, 8);
    expect(pairs).toEqual([]);
    expect(skipped).toEqual([{ key: 'shared.com', size: 20 }]);
  });

  it('keeps a group exactly at the threshold', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`r${i}`, 'X', 'shared.com'));
    const { pairs, skipped } = sweep(rows, byDomain, 8);
    expect(pairs).toHaveLength((8 * 7) / 2);
    expect(skipped).toEqual([]);
  });

  it('ignores rows whose key is empty', () => {
    // A blank domain is "not recorded", not a domain two rows have in common.
    const rows = [row('a', 'A', ''), row('b', 'B', ''), row('c', 'C', null)];
    expect(sweep(rows, byDomain, 8).pairs).toEqual([]);
  });

  it('carries the shared key as the evidence a reviewer checks', () => {
    const { pairs } = sweep(
      [row('a', 'Acme, Inc.'), row('b', 'Acme Inc')],
      (r) => r.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
      8,
    );
    expect(pairs[0]!.evidence).toBe('acmeinc');
  });
});

describe('detectorNameKey', () => {
  it('closes the punctuation gap the company matcher leaves open', () => {
    // These two are ONE SEC filer (same CIK), spelled two ways. normalizeName
    // deletes the comma, so "HeavyTech,Inc." collapses to "heavytechinc" and
    // never meets "heavytech" — which is why the matcher created two rows and
    // why the detector cannot reuse the matcher's key.
    expect(normalizeName('HeavyTech,Inc.')).not.toBe(normalizeName('HeavyTech, Inc.'));
    expect(detectorNameKey('HeavyTech,Inc.')).toBe(detectorNameKey('HeavyTech, Inc.'));
  });

  it('still separates genuinely different names', () => {
    expect(detectorNameKey('Koolbridge Energy, Inc.')).not.toBe(
      detectorNameKey('Koolbridge Solar, Inc.'),
    );
  });

  it('strips legal suffixes so one spelling of a suffix is not a difference', () => {
    expect(detectorNameKey('Acme Robotics, Inc.')).toBe(detectorNameKey('Acme Robotics LLC'));
  });
});
