// What makes a profile worth a search engine's time. Below the bar a page stays
// public and crawlable (noindex, follow) and leaves the sitemap; it crosses the
// bar on its own as data arrives. The API applies this; the web only reads
// `indexable` off the detail response.
//
// An investor needs any one of: a public portfolio holding, a named fund, or an
// officer on record — "at least one" needs no constant.

/** A person needs this many public roles — or a Wikidata identifier. */
export const PERSON_INDEX_MIN_ROLES = 2;
