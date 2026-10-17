import { describe, expect, it } from '@jest/globals';

import { planFundSlugs, uniqueFundSlug } from './fund-slug';

describe('uniqueFundSlug', () => {
  it('kebabs the name and registers it', () => {
    const slugs = new Set<string>();
    expect(uniqueFundSlug('Sequoia Capital Fund XV, L.P.', '805-1', slugs)).toBe('sequoia-capital-fund-xv-l-p');
    expect(slugs.has('sequoia-capital-fund-xv-l-p')).toBe(true);
  });

  it('disambiguates a taken name with the source id, then a counter', () => {
    const slugs = new Set(['fund-i']);
    expect(uniqueFundSlug('Fund I', 'abc 1', slugs)).toBe('fund-i-abc-1');
    expect(uniqueFundSlug('Fund I', 'abc 1', slugs)).toBe('fund-i-2');
    expect(uniqueFundSlug('Fund I', null, slugs)).toBe('fund-i-3');
  });

  it('never takes a path the router answers itself', () => {
    expect(uniqueFundSlug('Sitemap', null, new Set())).toBe('sitemap-2');
  });

  it('falls back to "fund" for a name with no letters or digits', () => {
    expect(uniqueFundSlug('***', null, new Set())).toBe('fund');
  });
});

describe('planFundSlugs', () => {
  it('gives every fund a distinct slug, unique against those already held', () => {
    const slugs = new Set(['fund-i']);
    const plan = planFundSlugs(
      [
        { id: 'a', name: 'Fund I', externalId: '805-1' },
        { id: 'b', name: 'Fund I', externalId: '805-2' },
        { id: 'c', name: 'Fund I', externalId: null },
        { id: 'd', name: 'Other Fund', externalId: null },
      ],
      slugs,
    );
    const values = plan.map((p) => p.slug);
    expect(new Set(values).size).toBe(4);
    expect(values).not.toContain('fund-i');
    expect(plan.find((p) => p.id === 'd')!.slug).toBe('other-fund');
  });

  it('plans nothing for nothing, so a re-run after a full pass writes 0', () => {
    expect(planFundSlugs([], new Set(['x']))).toEqual([]);
  });
});
