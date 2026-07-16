/**
 * Pure SPARQL query builders for the Wikidata enrichment source. The seed
 * query finds every company carrying investor (P1951) statements; detail
 * queries then batch those QIDs through VALUES chunks.
 *
 * Properties used: P1951 investor, P856 website, P571 inception, P159 HQ,
 * P17 country, P452 industry, P1128 employees, P4264 LinkedIn id,
 * P112 founder, P169 CEO, P127 owned-by, P793 significant event
 * (Q184680 = IPO), P414 stock exchange; qualifiers P580 start, P585 point.
 */

/** Chunk size for VALUES batching — stays well under the WDQS 60s timeout. */
export const WDQS_CHUNK_SIZE = 200;

export function chunkQids(qids: string[], size = WDQS_CHUNK_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < qids.length; i += size) out.push(qids.slice(i, i + size));
  return out;
}

const LABEL_SERVICE = 'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }';

function values(qids: string[]): string {
  return `VALUES ?company { ${qids.map((q) => `wd:${q}`).join(' ')} }`;
}

/** Every company with at least one investor statement (~6.4k as of 2026-07). */
export function seedQuery(): string {
  return `SELECT DISTINCT ?company WHERE { ?company wdt:P1951 ?investor . }`;
}

/** Company metadata (all OPTIONAL; multi-valued rows deduped first-wins downstream). */
export function detailsQuery(qids: string[]): string {
  return `SELECT ?company ?companyLabel ?companyDescription ?website ?inception ?hqLabel ?countryLabel ?industryLabel ?employees ?linkedinId WHERE {
  ${values(qids)}
  OPTIONAL { ?company wdt:P856 ?website . }
  OPTIONAL { ?company wdt:P571 ?inception . }
  OPTIONAL { ?company wdt:P159 ?hq . }
  OPTIONAL { ?company wdt:P17 ?country . }
  OPTIONAL { ?company wdt:P452 ?industry . }
  OPTIONAL { ?company wdt:P1128 ?employees . }
  OPTIONAL { ?company wdt:P4264 ?linkedinId . }
  ${LABEL_SERVICE}
}`;
}

export function investorsQuery(qids: string[]): string {
  return `SELECT ?company ?investor ?investorLabel WHERE {
  ${values(qids)}
  ?company wdt:P1951 ?investor .
  ${LABEL_SERVICE}
}`;
}

/** Founders (P112) and CEOs (P169, with optional start qualifier). */
export function peopleQuery(qids: string[]): string {
  return `SELECT ?company ?person ?personLabel ?role ?start WHERE {
  ${values(qids)}
  {
    ?company p:P112 ?st .
    ?st ps:P112 ?person .
    BIND("Founder" AS ?role)
  } UNION {
    ?company p:P169 ?st .
    ?st ps:P169 ?person .
    OPTIONAL { ?st pq:P580 ?start . }
    BIND("CEO" AS ?role)
  }
  ${LABEL_SERVICE}
}`;
}

/** Deals the company made: targets owned-by (P127) the company, date required. */
export function acquisitionsQuery(qids: string[]): string {
  return `SELECT ?company ?target ?targetLabel ?date WHERE {
  ${values(qids)}
  ?target p:P127 ?st .
  ?st ps:P127 ?company .
  ?st pq:P580 ?date .
  ${LABEL_SERVICE}
}`;
}

/** Exits: the company was acquired (owned-by with a dated start), or IPO'd
 *  (significant event = IPO, with listing start date as fallback). */
export function exitsQuery(qids: string[]): string {
  return `SELECT ?company ?kind ?acquirer ?acquirerLabel ?date WHERE {
  ${values(qids)}
  {
    ?company p:P127 ?st .
    ?st ps:P127 ?acquirer .
    ?st pq:P580 ?date .
    BIND("acq" AS ?kind)
  } UNION {
    ?company p:P793 ?ipo .
    ?ipo ps:P793 wd:Q184680 .
    OPTIONAL { ?ipo pq:P585 ?date . }
    BIND("ipo" AS ?kind)
  } UNION {
    ?company p:P414 ?listing .
    ?listing pq:P580 ?date .
    BIND("ipo" AS ?kind)
  }
  ${LABEL_SERVICE}
}`;
}
