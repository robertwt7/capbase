import { describe, it, expect } from '@jest/globals';

import { hostOf, identifyingDomain, isLinkedInHost, isPlatformHost, isSocialHost } from './domain';

describe('hostOf', () => {
  it.each([
    ['https://www.nextcoastventures.com', 'nextcoastventures.com'],
    ['HTTP://WWW.DFJ.COM', 'dfj.com'],
    ['up.partners', 'up.partners'],
    ['https://viola-group.com/team', 'viola-group.com'],
    ['', ''],
    ['   ', ''],
    ['linkedin', ''], // not a hostname
    ['@providencewealth', ''],
  ])('%s → %s', (input, expected) => {
    expect(hostOf(input)).toBe(expected);
  });
});

describe('identifyingDomain', () => {
  it('returns the host for a firm’s own website', () => {
    expect(identifyingDomain('https://www.sequoiacap.com')).toBe('sequoiacap.com');
    expect(identifyingDomain('viola-group.com')).toBe('viola-group.com');
  });

  it('returns null for publishing platforms and profile aggregators', () => {
    // 21 advisers listed the same medium.com blog and 8 their crunchbase page.
    // Matching on those hosts merged Founders Fund, Menlo Ventures and Beringea
    // into a single investor.
    for (const url of [
      'https://medium.com/@foundersfund',
      'https://www.crunchbase.com/organization/quake-capital',
      'https://someone.wordpress.com',
      'https://myfirm.wixsite.com/home',
      'https://sites.google.com/view/fund',
      'https://linktr.ee/fund',
    ]) {
      expect(identifyingDomain(url)).toBeNull();
    }
  });

  it('returns null for LinkedIn and other social hosts', () => {
    expect(identifyingDomain('https://www.linkedin.com/company/team8')).toBeNull();
    expect(identifyingDomain('https://x.com/468Capital')).toBeNull();
    expect(identifyingDomain('https://www.facebook.com/fund')).toBeNull();
  });

  it('matches platform subdomains, not merely lookalike suffixes', () => {
    expect(isPlatformHost('blog.medium.com')).toBe(true);
    expect(isPlatformHost('notmedium.com')).toBe(false);
    expect(isSocialHost('m.facebook.com')).toBe(true);
    expect(isLinkedInHost('uk.linkedin.com')).toBe(true);
    expect(isLinkedInHost('linkedin.com.attacker.io')).toBe(false);
  });

  it('returns null for junk rather than guessing', () => {
    expect(identifyingDomain(null)).toBeNull();
    expect(identifyingDomain('saxony')).toBeNull();
  });
});
