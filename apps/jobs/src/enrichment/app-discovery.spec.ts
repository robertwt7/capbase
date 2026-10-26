import { describe, expect, it } from '@jest/globals';

import { corroborateAppIdentity, discoverAppLinks, parseStoreAppUrl } from './app-discovery';

describe('official website app links', () => {
  it('extracts canonical Apple and Google Play product IDs, stripping tracking data', () => {
    const html = '<a href="https://apps.apple.com/us/app/example/id123456789?utm_source=secret&amp;mt=8">App Store</a>' +
      '<a href="https://play.google.com/store/apps/details?id=com.example.app&amp;referrer=token">Google Play</a>' +
      '<a href="https://itunes.apple.com/gb/app/old-title/id123456789?at=token">Duplicate</a>';
    expect(discoverAppLinks(html, 'https://example.com/')).toEqual([
      { store: 'APPLE', appId: '123456789', storeUrl: 'https://apps.apple.com/app/id123456789' },
      { store: 'GOOGLE_PLAY', appId: 'com.example.app', storeUrl: 'https://play.google.com/store/apps/details?id=com.example.app' },
    ]);
  });

  it.each([
    'https://apps.apple.com.attacker.com/us/app/example/id123456789',
    'https://fake-apps.apple.com/us/app/example/id123456789',
    'https://apps.apple.com@attacker.com/us/app/example/id123456789',
    'https://user@apps.apple.com/us/app/example/id123456789',
    'https://apps.apple.com:8443/us/app/example/id123456789',
    'https://apps.apple.com/us/app/example/id000123',
    'https://apps.apple.com/us/app/example/id0',
    'https://apps.apple.com/us/app/example/id123evil',
    'https://apps.apple.com/us/developer/id123456789',
    'https://apps.apple.com/us/search?term=example',
    'https://play.google.com.attacker.com/store/apps/details?id=com.example.app',
    'https://play.google.com/store/apps/developer?id=Example',
    'https://play.google.com/store/search?q=example',
    'https://play.google.com/store/apps/details?id=com.example.app&id=com.attacker.app',
    'https://play.google.com/store/apps/details?id=com.example.app%26evil',
    'https://play.google.com/store/apps/details?id=com..example',
    'https://play.google.com/store/apps/details?id=example',
    'https://play.google.com/store/apps/details?id=1com.example',
    'javascript:https://apps.apple.com/app/id123',
    'https://apps.apple.com./app/id123',
  ])('rejects lookalikes, search results and malformed IDs: %s', (url) => {
    expect(parseStoreAppUrl(url)).toBeNull();
  });

  it('uses parsed anchor tags only, with a bounded number of candidate products', () => {
    const fake = '<!-- <a href="https://apps.apple.com/app/id123"> -->' +
      '<script>"<a href=\'https://apps.apple.com/app/id123\'>"</script>' +
      '<div>https://apps.apple.com/app/id123</div>';
    expect(discoverAppLinks(fake, 'https://example.com/')).toEqual([]);
    const links = Array.from({ length: 50 }, (_, index) => `<a href="https://apps.apple.com/app/id${index + 1}">App</a>`).join('');
    expect(discoverAppLinks(links, 'https://example.com/')).toHaveLength(25);
  });

  it('resolves scheme-relative official links and old explicit HTTP store links safely', () => {
    expect(discoverAppLinks('<a href="//apps.apple.com/gb/app/id123">App</a>' +
      '<a href="http://play.google.com/store/apps/details?id=com.Example_app.android">Android</a>', 'https://example.com/')).toEqual([
      { store: 'APPLE', appId: '123', storeUrl: 'https://apps.apple.com/app/id123' },
      { store: 'GOOGLE_PLAY', appId: 'com.Example_app.android', storeUrl: 'https://play.google.com/store/apps/details?id=com.Example_app.android' },
    ]);
  });
});

describe('app seller website corroboration', () => {
  it('compares identifying registrable domains, including public suffix boundaries', () => {
    expect(corroborateAppIdentity('https://www.example.co.uk/', 'https://apps.example.co.uk/')).toEqual({
      status: 'DOMAIN_CORROBORATED', companyDomain: 'example.co.uk', sellerDomain: 'example.co.uk', requiresOperatorVerification: true,
    });
    expect(corroborateAppIdentity('https://example.co.uk/', 'https://other.co.uk/').status).toBe('DOMAIN_CONFLICT');
    expect(corroborateAppIdentity('https://example.com/', 'https://example.com.attacker.org/').status).toBe('DOMAIN_CONFLICT');
  });

  it('never infers company ownership from a shared publisher or agency', () => {
    expect(corroborateAppIdentity('https://agency.com/', 'https://agency.com/', true)).toMatchObject({
      status: 'SHARED_PUBLISHER', requiresOperatorVerification: true,
    });
    expect(corroborateAppIdentity('https://customer.com/', 'https://agency.com/')).toMatchObject({
      status: 'DOMAIN_CONFLICT', requiresOperatorVerification: true,
    });
  });

  it('keeps missing, transferred, unsafe and platform seller sites private candidates', () => {
    for (const seller of [undefined, '', 'not a url', 'https://facebook.com/company', 'https://medium.com/company', 'http://localhost/', 'https://user@example.com/']) {
      expect(corroborateAppIdentity('https://example.com/', seller)).toMatchObject({ status: 'UNVERIFIED', requiresOperatorVerification: true });
    }
    expect(corroborateAppIdentity('https://old-owner.com/', 'https://new-owner.com/')).toMatchObject({
      status: 'DOMAIN_CONFLICT', requiresOperatorVerification: true,
    });
  });
});
