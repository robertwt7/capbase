// What makes a profile worth a search engine's time. Below the bar a page stays
// public and crawlable (noindex, follow) and leaves the sitemap; it crosses the
// bar on its own as data arrives. The API applies this; the web only reads
// `indexable` off the detail response.
//
// Every public-record company is indexable; a partner-only company needs a
// non-empty oneLiner or description. An investor needs a non-empty description
// (partner-only stubs included), or a public-record profile with at least one
// portfolio holding, named fund, officer or commitment. People and funds use
// the rules below.

/** A person needs this many public roles — or a Wikidata identifier. */
export const PERSON_INDEX_MIN_ROLES = 2;

/** The facts `fundIndexable` reads. */
export interface FundIndexFacts {
  commitmentCount: number;
  closedUsd?: number | null;
  targetUsd?: number | null;
  finalCloseDate?: string | null;
  managementFeePct?: number | null;
}

/**
 * A fund page is worth indexing when it says something beyond a name: a public
 * commitment, a size, a target, a final close or a fee. The Form ADV SPV long
 * tail (a name and a NAV) stays `noindex, follow`. The API restates this in SQL
 * for `GET /funds/slugs` — keep the two in step.
 */
export function fundIndexable(f: FundIndexFacts): boolean {
  return (
    f.commitmentCount > 0 ||
    f.closedUsd != null ||
    f.targetUsd != null ||
    f.finalCloseDate != null ||
    f.managementFeePct != null
  );
}
