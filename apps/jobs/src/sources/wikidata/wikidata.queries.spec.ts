import { describe, it, expect } from '@jest/globals';

import {
  WDQS_CHUNK_SIZE,
  acquisitionsQuery,
  chunkQids,
  detailsQuery,
  exitsQuery,
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
});
