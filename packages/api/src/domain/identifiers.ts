// External identifiers — the crosswalk that lets a Capbase row be joined to the
// rest of the world, and the strongest signal that two of our rows are the same
// entity. Same convention as the other controlled vocabularies here: a
// string-literal union plus a `readonly` const array, stored as a plain String
// column and validated in DTOs with @IsIn([...]). Runtime-dependency-free.

export type IdentifierScheme =
  /** GLEIF Legal Entity Identifier (ISO 17442). */
  | 'LEI'
  /** SEC Central Index Key — one filer. */
  | 'CIK'
  /** FINRA/IAPD Central Registration Depository number. */
  | 'CRD'
  /** Wikidata QID. */
  | 'WIKIDATA'
  /** OpenCorporates "<jurisdiction>/<number>", e.g. us_de/1234567. */
  | 'OPENCORPORATES'
  /** Exchange-qualified stock ticker, e.g. NASDAQ:ABNB. */
  | 'TICKER'
  /** SAM.gov Unique Entity ID. */
  | 'UEI'
  /** Dun & Bradstreet number. */
  | 'DUNS'
  /** Identifying web host (see apps/jobs/src/util/domain.ts for what counts). */
  | 'DOMAIN';

export const IDENTIFIER_SCHEMES: readonly IdentifierScheme[] = [
  'LEI',
  'CIK',
  'CRD',
  'WIKIDATA',
  'OPENCORPORATES',
  'TICKER',
  'UEI',
  'DUNS',
  'DOMAIN',
];

/** What an identifier can point at. Funds are excluded on purpose: they are
 *  ingest-only, have no page, and their names collide degenerately. */
export type IdentifiableType = 'company' | 'investor';

export const IDENTIFIABLE_TYPES: readonly IdentifiableType[] = ['company', 'investor'];

/** An identifier as it reaches a reader: canonical value plus the issuer's
 *  public page for it, when the issuer publishes one. */
export interface EntityIdentifierRef {
  scheme: IdentifierScheme;
  value: string;
  /** Derived, never stored — `identifierUrl(scheme, value)`. */
  url: string | null;
}

/** ISO 7064 MOD 97-10, as ISO 17442 specifies for an LEI: map A–Z to 10–35,
 *  read the 20 characters as one integer, and require `n mod 97 === 1`. Folded
 *  incrementally so no BigInt is needed.
 *
 *  `value` has already passed the shape check, so every character here is a
 *  digit (one place) or an uppercase letter (two places). */
function isValidLei(value: string): boolean {
  let remainder = 0;
  for (const char of value) {
    const code = char.charCodeAt(0);
    remainder =
      code <= 57 ? (remainder * 10 + (code - 48)) % 97 : (remainder * 100 + (code - 55)) % 97;
  }
  return remainder === 1;
}

/**
 * Canonical form of a raw identifier, or null when it does not match the
 * scheme's shape.
 *
 * Null is load-bearing. A malformed identifier that entered the crosswalk would
 * join two unrelated entities — worse than having no identifier at all — so a
 * value we cannot validate is dropped rather than stored.
 */
export function normalizeIdentifier(scheme: IdentifierScheme, raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  switch (scheme) {
    case 'CIK': {
      // EDGAR writes a CIK with and without leading zeros depending on the
      // endpoint; 10 digits is the canonical width.
      if (!/^\d{1,10}$/.test(trimmed)) return null;
      const padded = trimmed.padStart(10, '0');
      return padded === '0000000000' ? null : padded;
    }
    case 'CRD': {
      if (!/^\d+$/.test(trimmed)) return null;
      const stripped = trimmed.replace(/^0+/, '');
      return stripped === '' ? null : stripped;
    }
    case 'LEI': {
      const upper = trimmed.toUpperCase();
      // 18 alphanumerics + 2 check digits. The checksum is verified because
      // LEIs reach us through Wikidata, where anyone can type one.
      if (!/^[0-9A-Z]{18}[0-9]{2}$/.test(upper)) return null;
      return isValidLei(upper) ? upper : null;
    }
    case 'WIKIDATA': {
      const upper = trimmed.toUpperCase();
      // Items only: a P… property or an L… lexeme is not an entity we hold.
      return /^Q[1-9]\d*$/.test(upper) ? upper : null;
    }
    case 'OPENCORPORATES': {
      const lower = trimmed.toLowerCase().replace(/^\/+|\/+$/g, '');
      return /^[a-z]{2}(_[a-z0-9]+)?\/[a-z0-9_-]+$/.test(lower) ? lower : null;
    }
    case 'TICKER': {
      const upper = trimmed.toUpperCase();
      // Exchange-qualified only: AAPL on two exchanges is two instruments, so a
      // bare symbol identifies nothing.
      const match = /^([A-Z][A-Z0-9.]*):([A-Z0-9][A-Z0-9.-]*)$/.exec(upper);
      return match ? `${match[1]}:${match[2]}` : null;
    }
    case 'UEI': {
      const upper = trimmed.toUpperCase();
      // SAM's alphabet excludes I and O so they cannot be confused with 1 and 0.
      return /^[A-HJ-NP-Z0-9]{12}$/.test(upper) ? upper : null;
    }
    case 'DUNS': {
      if (!/^\d{1,9}$/.test(trimmed)) return null;
      const padded = trimmed.padStart(9, '0');
      return padded === '000000000' ? null : padded;
    }
    case 'DOMAIN': {
      const lower = trimmed
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/^www\./, '');
      return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(lower)
        ? lower
        : null;
    }
    default:
      // Unreachable for a well-typed caller, but `scheme` is a plain String
      // column: a row written by an older or buggier writer must normalize to
      // null rather than crash the read.
      return null;
  }
}

/** The schemes whose issuer publishes a public page for every value. The two
 *  that don't: DUNS sits behind D&B's paywall, and a ticker has no neutral
 *  canonical page (an exchange's own listing page is not one). */
export type LinkedScheme = Exclude<IdentifierScheme, 'TICKER' | 'DUNS'>;

const LINKED_URLS: Record<LinkedScheme, (value: string) => string> = {
  LEI: (v) => `https://search.gleif.org/#/record/${v}`,
  CIK: (v) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${v}`,
  CRD: (v) => `https://adviserinfo.sec.gov/firm/summary/${v}`,
  WIKIDATA: (v) => `https://www.wikidata.org/wiki/${v}`,
  OPENCORPORATES: (v) => `https://opencorporates.com/companies/${v}`,
  UEI: (v) => `https://sam.gov/entity/${v}`,
  DOMAIN: (v) => `https://${v}`,
};

/** The issuer's page for a scheme that always has one. Callers that already
 *  know the scheme statically (the EDGAR and Wikidata URL helpers) use this so
 *  they get a `string` back and those URLs keep exactly one definition. */
export function linkedIdentifierUrl(scheme: LinkedScheme, value: string): string {
  return LINKED_URLS[scheme](value);
}

/**
 * The issuer's public page for an identifier, or null when there isn't one.
 *
 * Null renders as plain text rather than a dead link.
 */
export function identifierUrl(scheme: IdentifierScheme, value: string): string | null {
  const template = (LINKED_URLS as Partial<Record<IdentifierScheme, (value: string) => string>>)[
    scheme
  ];
  return template ? template(value) : null;
}
