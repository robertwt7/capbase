import { describe, expect, it } from '@jest/globals';

import { claimableHost, emailHost, emailMatchesCompany } from './claimable-domain';

describe('claimableHost', () => {
  it('returns the ASCII host of a company domain', () => {
    expect(claimableHost('acme.com')).toBe('acme.com');
    expect(claimableHost('Acme.COM')).toBe('acme.com');
    expect(claimableHost('shop.acme.com')).toBe('shop.acme.com');
    expect(claimableHost('acme.co.uk')).toBe('acme.co.uk');
  });

  it('strips a legacy www., scheme or path', () => {
    expect(claimableHost('www.acme.com')).toBe('acme.com');
    expect(claimableHost('https://www.acme.com/about')).toBe('acme.com');
  });

  it('converts an internationalised domain to punycode', () => {
    expect(claimableHost('acmé.com')).toBe('xn--acm-dma.com');
  });

  it.each(['gmail.com', 'medium.com', 'linkedin.com', 'uk.linkedin.com', 'x.com', 'github.io', 'co.uk', 'com'])(
    '%s is not claimable by email',
    (domain) => {
      expect(claimableHost(domain)).toBeNull();
    },
  );

  it('refuses an empty or junk domain', () => {
    expect(claimableHost('')).toBeNull();
    expect(claimableHost('   ')).toBeNull();
    expect(claimableHost('saxony')).toBeNull();
  });

  it('refuses a subdomain of a platform host (the host belongs to the platform)', () => {
    expect(claimableHost('acme.github.io')).toBeNull();
    expect(claimableHost('acme.wordpress.com')).toBeNull();
  });
});

describe('emailHost', () => {
  it('lower-cases and punycodes the address host', () => {
    expect(emailHost('Jane@Acme.COM')).toBe('acme.com');
    expect(emailHost('jane@acmé.com')).toBe('xn--acm-dma.com');
    expect(emailHost('jane@acme.com.')).toBe('acme.com');
  });

  it('returns empty for something that is not an address', () => {
    expect(emailHost('jane')).toBe('');
    expect(emailHost('@acme.com')).toBe('');
  });
});

describe('emailMatchesCompany', () => {
  it.each([
    ['jane@acme.com', 'acme.com', true],
    ['jane@eu.acme.com', 'acme.com', true],
    ['jane@acme.com', 'www.acme.com', true],
    ['jane@acme.com', 'shop.acme.com', false],
    ['jane@acme.co', 'acme.com', false],
    ['jane@acmé.com', 'acme.com', false],
    ['jane@notacme.com', 'acme.com', false],
    ['jane@acme.com.evil.io', 'acme.com', false],
    ['jane@gmail.com', 'gmail.com', false],
    ['jane@medium.com', 'medium.com', false],
    ['jane@linkedin.com', 'linkedin.com', false],
    ['jane@foo.co.uk', 'co.uk', false],
    ['jane@acme.com', '', false],
    ['jane@acmé.com', 'acmé.com', true],
  ])('%s against %s → %s', (email, domain, expected) => {
    expect(emailMatchesCompany(email, domain)).toBe(expected);
  });
});
