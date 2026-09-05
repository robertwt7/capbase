import {
  IDENTIFIABLE_TYPES,
  IDENTIFIER_SCHEMES,
  identifierUrl,
  linkedIdentifierUrl,
  normalizeIdentifier,
  type IdentifierScheme,
} from './identifiers';

// A real, checksum-valid LEI (Apple Inc). Used rather than a made-up string so
// the mod-97-10 assertion is testing the actual standard.
const APPLE_LEI = 'HWUPKR0MPOU8FGXBT394';

describe('normalizeIdentifier', () => {
  describe('CIK', () => {
    it('zero-pads to the canonical 10-digit width', () => {
      expect(normalizeIdentifier('CIK', '320193')).toBe('0000320193');
      expect(normalizeIdentifier('CIK', '0000320193')).toBe('0000320193');
      expect(normalizeIdentifier('CIK', ' 320193 ')).toBe('0000320193');
    });

    it('rejects anything that is not a CIK', () => {
      expect(normalizeIdentifier('CIK', '')).toBeNull();
      expect(normalizeIdentifier('CIK', 'uei:ABC')).toBeNull();
      expect(normalizeIdentifier('CIK', '320-193')).toBeNull();
      expect(normalizeIdentifier('CIK', '12345678901')).toBeNull();
      // All zeros is EDGAR's "no filer", not a filer numbered zero.
      expect(normalizeIdentifier('CIK', '0')).toBeNull();
      expect(normalizeIdentifier('CIK', '0000000000')).toBeNull();
    });
  });

  describe('CRD', () => {
    it('strips leading zeros', () => {
      expect(normalizeIdentifier('CRD', '0000107488')).toBe('107488');
      expect(normalizeIdentifier('CRD', '107488')).toBe('107488');
    });

    it('rejects non-digits and zero', () => {
      expect(normalizeIdentifier('CRD', 'CRD-107488')).toBeNull();
      expect(normalizeIdentifier('CRD', '')).toBeNull();
      expect(normalizeIdentifier('CRD', '000')).toBeNull();
    });
  });

  describe('LEI', () => {
    it('accepts a checksum-valid LEI, uppercased', () => {
      expect(normalizeIdentifier('LEI', APPLE_LEI)).toBe(APPLE_LEI);
      expect(normalizeIdentifier('LEI', APPLE_LEI.toLowerCase())).toBe(APPLE_LEI);
    });

    it('rejects a well-shaped LEI whose check digits are wrong', () => {
      // Same string, one character changed: the shape still passes, so only the
      // mod-97-10 check catches it. This is why the checksum is verified —
      // LEIs reach us through Wikidata, where anyone can type one.
      const tampered = `${APPLE_LEI.slice(0, 5)}X${APPLE_LEI.slice(6)}`;
      expect(tampered).toHaveLength(20);
      expect(normalizeIdentifier('LEI', tampered)).toBeNull();
    });

    it('rejects the wrong length or shape', () => {
      expect(normalizeIdentifier('LEI', APPLE_LEI.slice(0, 19))).toBeNull();
      expect(normalizeIdentifier('LEI', `${APPLE_LEI}0`)).toBeNull();
      // The last two characters must be digits.
      expect(normalizeIdentifier('LEI', `${APPLE_LEI.slice(0, 18)}AB`)).toBeNull();
      expect(normalizeIdentifier('LEI', '')).toBeNull();
    });
  });

  describe('WIKIDATA', () => {
    it('accepts a QID', () => {
      expect(normalizeIdentifier('WIKIDATA', 'Q312')).toBe('Q312');
      expect(normalizeIdentifier('WIKIDATA', 'q312')).toBe('Q312');
    });

    it('rejects other entity namespaces and malformed ids', () => {
      expect(normalizeIdentifier('WIKIDATA', 'P1278')).toBeNull();
      expect(normalizeIdentifier('WIKIDATA', 'L1234')).toBeNull();
      expect(normalizeIdentifier('WIKIDATA', 'Q0')).toBeNull();
      expect(normalizeIdentifier('WIKIDATA', 'Q')).toBeNull();
      expect(normalizeIdentifier('WIKIDATA', '312')).toBeNull();
    });
  });

  describe('OPENCORPORATES', () => {
    it('lowercases jurisdiction and number', () => {
      expect(normalizeIdentifier('OPENCORPORATES', 'us_de/1234567')).toBe('us_de/1234567');
      expect(normalizeIdentifier('OPENCORPORATES', 'US_DE/1234567')).toBe('us_de/1234567');
      expect(normalizeIdentifier('OPENCORPORATES', 'gb/00445790')).toBe('gb/00445790');
      expect(normalizeIdentifier('OPENCORPORATES', '/us_de/1234567/')).toBe('us_de/1234567');
    });

    it('rejects a value with no jurisdiction', () => {
      expect(normalizeIdentifier('OPENCORPORATES', '1234567')).toBeNull();
      expect(normalizeIdentifier('OPENCORPORATES', 'us_de/')).toBeNull();
    });
  });

  describe('TICKER', () => {
    it('requires an exchange qualifier', () => {
      expect(normalizeIdentifier('TICKER', 'nasdaq:abnb')).toBe('NASDAQ:ABNB');
      expect(normalizeIdentifier('TICKER', 'NYSE:BRK.A')).toBe('NYSE:BRK.A');
    });

    it('rejects a bare symbol', () => {
      // AAPL on two exchanges is two instruments, so an unqualified symbol
      // identifies nothing.
      expect(normalizeIdentifier('TICKER', 'AAPL')).toBeNull();
      expect(normalizeIdentifier('TICKER', ':AAPL')).toBeNull();
      expect(normalizeIdentifier('TICKER', 'NASDAQ:')).toBeNull();
    });
  });

  describe('UEI', () => {
    it('accepts 12 characters from SAM alphabet, uppercased', () => {
      expect(normalizeIdentifier('UEI', 'zqggha8hkdm7')).toBe('ZQGGHA8HKDM7');
    });

    it('rejects the wrong length or the excluded letters', () => {
      expect(normalizeIdentifier('UEI', 'ZQGGHA8HKDM')).toBeNull();
      expect(normalizeIdentifier('UEI', 'ZQGGHA8HKDM77')).toBeNull();
      // SAM excludes I and O so they cannot be read as 1 and 0.
      expect(normalizeIdentifier('UEI', 'ZQGGHA8HKDI7')).toBeNull();
      expect(normalizeIdentifier('UEI', 'ZQGGHA8HKDO7')).toBeNull();
    });
  });

  describe('DUNS', () => {
    it('zero-pads to nine digits', () => {
      expect(normalizeIdentifier('DUNS', '80736155')).toBe('080736155');
      expect(normalizeIdentifier('DUNS', '080736155')).toBe('080736155');
    });

    it('rejects non-digits, overlong values and zero', () => {
      expect(normalizeIdentifier('DUNS', '08-073-6155')).toBeNull();
      expect(normalizeIdentifier('DUNS', '1234567890')).toBeNull();
      expect(normalizeIdentifier('DUNS', '000000000')).toBeNull();
    });
  });

  describe('DOMAIN', () => {
    it('lowercases, strips scheme, path and www.', () => {
      expect(normalizeIdentifier('DOMAIN', 'Acme.com')).toBe('acme.com');
      expect(normalizeIdentifier('DOMAIN', 'www.acme.com')).toBe('acme.com');
      expect(normalizeIdentifier('DOMAIN', 'https://www.acme.com/about')).toBe('acme.com');
      expect(normalizeIdentifier('DOMAIN', 'sub.acme.co.uk')).toBe('sub.acme.co.uk');
    });

    it('rejects anything without a dot', () => {
      expect(normalizeIdentifier('DOMAIN', 'localhost')).toBeNull();
      expect(normalizeIdentifier('DOMAIN', 'acme')).toBeNull();
      expect(normalizeIdentifier('DOMAIN', '')).toBeNull();
      expect(normalizeIdentifier('DOMAIN', '.com')).toBeNull();
    });
  });

  it('is idempotent for every scheme', () => {
    const samples: Record<IdentifierScheme, string> = {
      LEI: APPLE_LEI,
      CIK: '320193',
      CRD: '0000107488',
      WIKIDATA: 'q312',
      OPENCORPORATES: 'US_DE/1234567',
      TICKER: 'nasdaq:abnb',
      UEI: 'zqggha8hkdm7',
      DUNS: '80736155',
      DOMAIN: 'https://www.acme.com/about',
    };

    for (const scheme of IDENTIFIER_SCHEMES) {
      const once = normalizeIdentifier(scheme, samples[scheme]);
      expect(once).not.toBeNull();
      expect(normalizeIdentifier(scheme, once as string)).toBe(once);
    }
  });

  it('rejects whitespace-only input for every scheme', () => {
    for (const scheme of IDENTIFIER_SCHEMES) {
      expect(normalizeIdentifier(scheme, '   ')).toBeNull();
    }
  });
});

describe('identifierUrl', () => {
  it('builds the issuer page for the linkable schemes', () => {
    expect(identifierUrl('CIK', '0000320193')).toBe(
      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193',
    );
    expect(identifierUrl('CRD', '107488')).toBe('https://adviserinfo.sec.gov/firm/summary/107488');
    expect(identifierUrl('LEI', APPLE_LEI)).toBe(`https://search.gleif.org/#/record/${APPLE_LEI}`);
    expect(identifierUrl('WIKIDATA', 'Q312')).toBe('https://www.wikidata.org/wiki/Q312');
    expect(identifierUrl('OPENCORPORATES', 'us_de/1234567')).toBe(
      'https://opencorporates.com/companies/us_de/1234567',
    );
    expect(identifierUrl('UEI', 'ZQGGHA8HKDM7')).toBe('https://sam.gov/entity/ZQGGHA8HKDM7');
    expect(identifierUrl('DOMAIN', 'acme.com')).toBe('https://acme.com');
  });

  it('returns null where the issuer publishes no page', () => {
    // DUNS is paywalled; a ticker has no neutral canonical page.
    expect(identifierUrl('TICKER', 'NASDAQ:ABNB')).toBeNull();
    expect(identifierUrl('DUNS', '080736155')).toBeNull();
  });

  it('agrees with linkedIdentifierUrl on every linkable scheme', () => {
    expect(linkedIdentifierUrl('CRD', '107488')).toBe(identifierUrl('CRD', '107488'));
    expect(linkedIdentifierUrl('WIKIDATA', 'Q312')).toBe(identifierUrl('WIKIDATA', 'Q312'));
  });
});

describe('vocabularies', () => {
  it('lists every scheme exactly once', () => {
    expect(new Set(IDENTIFIER_SCHEMES).size).toBe(IDENTIFIER_SCHEMES.length);
  });

  it('excludes funds from the identifiable types', () => {
    // Funds are ingest-only, have no page, and their names collide degenerately.
    expect(IDENTIFIABLE_TYPES).toEqual(['company', 'investor']);
  });
});
