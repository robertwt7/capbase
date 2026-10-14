/**
 * The pure half of `backfill-geography`: which country a row ingested before
 * `countryCode` existed is in, read back out of what its source stored in `hq`.
 *
 * Every rule reads a structured fragment the source itself wrote — an EDGAR
 * location code or description, a country name from a dropdown or a Wikidata
 * label. Nothing here reads a city: "London" is in Ontario too, and "LONDON,
 * Ohio" is an SBIR row. A row whose source wrote no country stays null.
 *
 * Separate from the CLI so it can be tested without booting a Nest context.
 */

import { countryCodeFromName } from '@repo/api';

import { countryFromEdgarCode, countryFromEdgarDescription } from '../sources/sec-edgar/edgar-locations';

/** Sources whose stored `hq` can be read back into a country. Anything else —
 *  SEC_S1, contributed rows — is left alone. */
export const GEOGRAPHY_SOURCES = ['SBIR', 'SEC_FORM_C', 'SEC_EDGAR', 'WIKIDATA', 'SEC_ADV'] as const;

/** `hq` split on the ", " every source joins its parts with. */
function segments(hq: string): string[] {
  return hq
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The last two segments joined back up, then the last alone: EDGAR writes
 *  "ONTARIO, CANADA" and Form ADV "Korea, South" — a country that is itself a
 *  comma pair — while most rows end in a one-segment country. */
function tail(hq: string, read: (s: string) => string | null): string | null {
  const parts = segments(hq);
  if (parts.length === 0) return null;
  if (parts.length >= 2) {
    const pair = read(parts.slice(-2).join(', '));
    if (pair) return pair;
  }
  return read(parts[parts.length - 1]!);
}

/** The trailing segment, for the "what didn't we recognise" log. */
export function trailingSegment(hq: string | null | undefined): string {
  const parts = segments(hq ?? '');
  return parts[parts.length - 1] ?? '';
}

/**
 * ISO country for one stored row, or null when its source stated none.
 *
 *   SBIR        always US — awardees must be US small businesses.
 *   SEC_FORM_C  "City, CODE" — the raw EDGAR location code.
 *   SEC_EDGAR   "City, DESCRIPTION" — EDGAR's description, or its code when
 *               the filing carried no description.
 *   WIKIDATA    "HQ, Country label" — "Undisclosed" when Wikidata had neither.
 *   SEC_ADV     "City, ST, Country" — the form's country dropdown.
 */
export function deriveCountry(source: string | null, hq: string | null | undefined): string | null {
  switch (source) {
    case 'SBIR':
      return 'US';
    case 'SEC_FORM_C':
      return countryFromEdgarCode(trailingSegment(hq));
    case 'SEC_EDGAR':
      return tail(hq ?? '', (s) => countryFromEdgarDescription(s) ?? countryFromEdgarCode(s));
    case 'WIKIDATA':
    case 'SEC_ADV':
      return tail(hq ?? '', countryCodeFromName);
    default:
      return null;
  }
}
