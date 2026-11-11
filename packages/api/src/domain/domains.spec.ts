import {
  claimDomainMatch,
  hostOf,
  identifyingDomain,
  isFreeMailHost,
  isLinkedInHost,
  isPlatformHost,
  isSocialHost,
} from './domains';

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

describe('isFreeMailHost', () => {
  it('matches consumer mailbox providers and their subdomains', () => {
    for (const host of ['gmail.com', 'googlemail.com', 'outlook.com', 'proton.me', 'qq.com']) {
      expect(isFreeMailHost(host)).toBe(true);
    }
    expect(isFreeMailHost('eu.gmail.com')).toBe(true);
  });

  it('does not match a company domain or a lookalike suffix', () => {
    expect(isFreeMailHost('acme.com')).toBe(false);
    expect(isFreeMailHost('notgmail.com')).toBe(false);
    expect(isFreeMailHost('gmail.com.evil.io')).toBe(false);
  });
});

describe('claimDomainMatch', () => {
  it.each([
    ['acme.com', 'acme.com', true],
    ['eu.acme.com', 'acme.com', true], // a subdomain of the stored host
    ['a.b.acme.com', 'acme.com', true],
    ['acme.com', 'shop.acme.com', false], // the parent of a stored subdomain
    ['acme.co', 'acme.com', false],
    ['xn--acm-dma.com', 'acme.com', false], // acmé.com in punycode
    ['notacme.com', 'acme.com', false], // a suffix without a dot boundary
    ['acme.com.evil.io', 'acme.com', false],
    ['acme.com', '', false],
    ['', 'acme.com', false],
  ])('%s against %s → %s', (emailHost, storedHost, expected) => {
    expect(claimDomainMatch(emailHost, storedHost)).toBe(expected);
  });
});
