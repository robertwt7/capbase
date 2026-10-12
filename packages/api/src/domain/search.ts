// The header typeahead: one call answers companies, investors and people.

/** Shorter input is not searched at all — no request is sent. */
export const SEARCH_MIN_CHARS = 2;
/** Matches returned per group. */
export const SEARCH_GROUP_LIMIT = 5;
/** Longest accepted query; anything longer is a 400. */
export const SEARCH_MAX_CHARS = 100;

/** One typeahead match, trimmed to what a dropdown row renders. */
export interface SearchHit {
  slug: string;
  name: string;
  /** Logo domain; null for people and logo-less rows (the monogram shows). */
  domain: string | null;
  /** One short disambiguating label: a company's sector, an investor's type,
   *  or the organisation of a person's most recent public role. */
  meta: string | null;
}

export interface SearchResponse {
  companies: SearchHit[];
  investors: SearchHit[];
  people: SearchHit[];
}
