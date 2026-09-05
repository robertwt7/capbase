import type { EntityIdentifierRef, IdentifierScheme } from '@repo/api';

/**
 * The identifier crosswalk block on a company or investor profile.
 *
 * This is the "open" half of open data: it says which SEC filer, which GLEIF
 * legal entity, which Wikidata item this row *is*, so anyone can join our
 * dataset to theirs. Rendered in the mono meta treatment the ledger uses for
 * every label and number — no colour, no accent.
 *
 * Renders nothing when the list is empty. An absent identifier is not an
 * invitation to contribute one (there is no form for it), so an empty-state box
 * would be a promise the product does not keep.
 */

/** Short labels; the scheme code is the identifier's public name, so these stay
 *  close to it rather than being expanded into prose. */
const SCHEME_LABELS: Record<IdentifierScheme, string> = {
  CIK: 'SEC CIK',
  CRD: 'CRD',
  LEI: 'LEI',
  WIKIDATA: 'Wikidata',
  OPENCORPORATES: 'OpenCorporates',
  TICKER: 'Ticker',
  UEI: 'SAM UEI',
  DUNS: 'DUNS',
  DOMAIN: 'Domain',
};

/** Where the value points, for a screen reader and a hover. */
const SCHEME_TITLES: Record<IdentifierScheme, string> = {
  CIK: 'SEC Central Index Key — the filer identity on EDGAR',
  CRD: 'FINRA Central Registration Depository number — the firm on IAPD',
  LEI: 'Legal Entity Identifier (ISO 17442) — the entity in the GLEIF index',
  WIKIDATA: 'Wikidata item',
  OPENCORPORATES: 'OpenCorporates company record',
  TICKER: 'Exchange-qualified stock ticker',
  UEI: 'SAM.gov Unique Entity ID — the federal contractor identity',
  DUNS: 'Dun & Bradstreet number',
  DOMAIN: 'Primary web domain',
};

export function Identifiers({
  identifiers,
  className,
}: {
  identifiers?: EntityIdentifierRef[];
  className?: string;
}) {
  if (!identifiers?.length) return null;

  return (
    <dl className={`flex flex-wrap gap-x-8 gap-y-4 ${className ?? ''}`}>
      {identifiers.map((id) => (
        <div key={`${id.scheme}:${id.value}`} className="flex flex-col gap-1">
          <dt
            className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase"
            title={SCHEME_TITLES[id.scheme]}
          >
            {SCHEME_LABELS[id.scheme] ?? id.scheme}
          </dt>
          <dd className="font-mono text-[13px] text-ink">
            {id.url ? (
              <a
                href={id.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-[3px] decoration-graphite-400 transition-colors hover:decoration-ink"
              >
                {id.value}
              </a>
            ) : (
              id.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
