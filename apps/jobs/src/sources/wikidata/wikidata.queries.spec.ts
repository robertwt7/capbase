import { describe, it, expect } from '@jest/globals';

import {
  WDQS_CHUNK_SIZE,
  acquisitionsQuery,
  chunkQids,
  detailsQuery,
  exitsQuery,
  investorFirmsQuery,
  investorsQuery,
  peopleQuery,
  seedQuery,
} from './wikidata.queries';

describe('chunkQids', () => {
  it('splits into pages of 200 by default', () => {
    const qids = Array.from({ length: 450 }, (_, i) => `Q${i + 1}`);
    const chunks = chunkQids(qids);
    expect(WDQS_CHUNK_SIZE).toBe(200);
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunks[0]![0]).toBe('Q1');
    expect(chunks[2]![49]).toBe('Q450');
  });

  it('returns no chunks for an empty list', () => {
    expect(chunkQids([])).toEqual([]);
  });
});

describe('query builders', () => {
  const qids = ['Q1', 'Q2'];

  it('seed query selects companies with investor (P1951) statements', () => {
    expect(seedQuery()).toContain('wdt:P1951');
    expect(seedQuery()).toContain('SELECT DISTINCT ?company');
  });

  it.each([
    ['details', detailsQuery(qids)],
    ['investors', investorsQuery(qids)],
    ['people', peopleQuery(qids)],
    ['acquisitions', acquisitionsQuery(qids)],
    ['exits', exitsQuery(qids)],
  ])('%s query batches QIDs via VALUES and uses the English label service', (_name, query) => {
    expect(query).toContain('VALUES ?company { wd:Q1 wd:Q2 }');
    expect(query).toContain('SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }');
  });

  it('people query unions founders (P112) and CEOs (P169)', () => {
    const q = peopleQuery(qids);
    expect(q).toContain('ps:P112');
    expect(q).toContain('ps:P169');
    expect(q).toContain('"Founder"');
    expect(q).toContain('"CEO"');
  });

  it('acquisitions query requires a dated owned-by statement', () => {
    const q = acquisitionsQuery(qids);
    expect(q).toContain('ps:P127 ?company');
    expect(q).toContain('pq:P580 ?date');
  });

  it('exits query covers acquisitions, IPO events and listings', () => {
    const q = exitsQuery(qids);
    expect(q).toContain('ps:P127 ?acquirer');
    expect(q).toContain('wd:Q184680');
    expect(q).toContain('p:P414');
  });

  it('investors query excludes the European Investment Bank and lender classes', () => {
    const q = investorsQuery(qids);
    // EIB carries no `development bank` class, so the QID exclusion is the only
    // thing that keeps it out — it was 79% of all P1951 edges.
    expect(q).toContain('wd:Q192247');
    expect(q).toContain('FILTER NOT EXISTS');
    expect(q).toContain('wd:Q1345691'); // international financial institution
    expect(q).toContain('wd:Q5266746'); // development bank
  });

  it('investors query selects the P31 classes used for structural typing', () => {
    expect(investorsQuery(qids)).toContain('OPTIONAL { ?investor wdt:P31 ?class . }');
  });
});

describe('investorFirmsQuery', () => {
  it('enumerates the investor firm classes without needing a P1951 edge', () => {
    const q = investorFirmsQuery();
    expect(q).toContain('VALUES ?class { wd:Q3487908 wd:Q5418962 wd:Q4086495 wd:Q1132207 wd:Q105611 wd:Q1061648 }');
    expect(q).toContain('?investor wdt:P31 ?class .');
    expect(q).not.toContain('wdt:P1951');
  });

  it('pulls the firm profile fields, using P4103 for AUM (not P2403)', () => {
    const q = investorFirmsQuery();
    expect(q).toContain('wdt:P856'); // website
    expect(q).toContain('wdt:P571'); // inception
    expect(q).toContain('wdt:P159'); // headquarters
    expect(q).toContain('wdt:P4103'); // assets under management
    expect(q).not.toContain('wdt:P2403'); // total assets — the wrong property
    expect(q).toContain('SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }');
  });

  it('excludes the EIB from the firm universe too', () => {
    expect(investorFirmsQuery()).toContain('wd:Q192247');
  });
});
