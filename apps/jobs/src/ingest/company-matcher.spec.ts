import { describe, expect, it } from '@jest/globals';

import {
  bindingEvidence,
  canonicalJson,
  companyIdentityKey,
  decideCompanyMatch,
  type CandidateEvidence,
  type MatchInput,
} from './company-matcher';

const company = (id: string, over: Partial<CandidateEvidence> = {}): CandidateEvidence => ({
  id,
  live: true,
  externalSource: 'SEC_EDGAR',
  externalId: `own-${id}`,
  recordIds: [],
  unresolvedAliases: [],
  companyNumber: null,
  countryCode: null,
  ...over,
});

function input(over: Partial<MatchInput> = {}): MatchInput {
  return {
    source: 'PARTNER',
    sourceCompanyId: '723159',
    ownCompanyId: null,
    binding: null,
    legalHits: new Map(),
    recordHits: new Map(),
    domainHolders: [],
    companyNumber: null,
    candidates: new Map(),
    ...over,
  };
}

const withCandidates = (...cs: CandidateEvidence[]) => new Map(cs.map((c) => [c.id, c]));

describe('decideCompanyMatch', () => {
  it('a REVIEW_REQUIRED binding holds the record, own key included', () => {
    expect(
      decideCompanyMatch(input({ ownCompanyId: 'c-own', binding: { companyId: null, status: 'REVIEW_REQUIRED' } })),
    ).toMatchObject({ kind: 'hold', reason: 'review-required' });
  });

  it('routes by the own provenance key first', () => {
    expect(decideCompanyMatch(input({ ownCompanyId: 'c-own', domainHolders: ['c-x'] }))).toEqual({
      kind: 'existing',
      companyId: 'c-own',
      method: 'own',
    });
  });

  it('routes by a RESOLVED binding, and holds when its company is gone', () => {
    const binding = { companyId: 'c-1', status: 'RESOLVED' as const };
    expect(decideCompanyMatch(input({ binding, candidates: withCandidates(company('c-1')) }))).toMatchObject({
      kind: 'existing',
      companyId: 'c-1',
      method: 'binding',
    });
    expect(
      decideCompanyMatch(input({ binding, candidates: withCandidates(company('c-1', { live: false })) })),
    ).toMatchObject({ kind: 'hold', reason: 'binding-target-gone' });
  });

  it('legal identifiers naming two companies are a conflict — no first-target pick', () => {
    const m = decideCompanyMatch(
      input({
        legalHits: new Map([
          ['CIK:1', 'c-a'],
          ['WIKIDATA:Q1', 'c-b'],
        ]),
        candidates: withCandidates(company('c-a'), company('c-b')),
      }),
    );
    expect(m).toEqual({ kind: 'conflict', reason: 'identifiers-disagree', companyIds: ['c-a', 'c-b'] });
  });

  it('a legal identifier associates even across a domain or a country', () => {
    expect(
      decideCompanyMatch(
        input({
          legalHits: new Map([['CIK:1', 'c-a']]),
          domainHolders: ['c-b'],
          candidates: withCandidates(company('c-a', { countryCode: 'US' }), company('c-b')),
        }),
      ),
    ).toMatchObject({ kind: 'existing', companyId: 'c-a', method: 'identifier' });
  });

  it('a legal identifier on a row holding a different Companies House number is a conflict', () => {
    expect(
      decideCompanyMatch(
        input({
          legalHits: new Map([['WIKIDATA:Q1', 'c-a']]),
          companyNumber: '00610201',
          candidates: withCandidates(company('c-a', { companyNumber: '01393773' })),
        }),
      ),
    ).toMatchObject({ kind: 'conflict', reason: 'company-number-differs' });
  });

  it('an unconfirmed record alias cannot vouch for itself: held', () => {
    // 723159 was attached to Indigo Ag by a name match; nothing confirms it.
    expect(
      decideCompanyMatch(
        input({
          recordHits: new Map([['PARTNER:723159', 'c-indigo-ag']]),
          candidates: withCandidates(company('c-indigo-ag')),
        }),
      ),
    ).toEqual({ kind: 'hold', reason: 'unbound-record-alias', companyIds: ['c-indigo-ag'] });
  });

  it('a unique domain associates', () => {
    expect(
      decideCompanyMatch(input({ domainHolders: ['c-1'], candidates: withCandidates(company('c-1')) })),
    ).toMatchObject({ kind: 'existing', companyId: 'c-1', method: 'domain' });
  });

  it('a shared domain is not first-wins: it associates with none', () => {
    expect(
      decideCompanyMatch(
        input({ domainHolders: ['c-1', 'c-2'], candidates: withCandidates(company('c-1'), company('c-2')) }),
      ),
    ).toMatchObject({ kind: 'create', reason: 'domain-shared' });
  });

  it('a different record of the same source on the domain holder keeps them apart', () => {
    const indigoAg = company('c-indigo-ag', { externalSource: 'PARTNER', externalId: '155553', recordIds: ['PARTNER:155553'] });
    expect(
      decideCompanyMatch(input({ domainHolders: ['c-indigo-ag'], candidates: withCandidates(indigoAg) })),
    ).toMatchObject({ kind: 'create', reason: 'distinct-source-record' });
  });

  it('a same-source record id carried as an alias also keeps them apart', () => {
    const publicRow = company('c-pub', { recordIds: ['PARTNER:111'] });
    expect(
      decideCompanyMatch(input({ domainHolders: ['c-pub'], candidates: withCandidates(publicRow) })),
    ).toMatchObject({ kind: 'create', reason: 'distinct-source-record' });
  });

  it('a domain landing on a company with an uncertified alias is held', () => {
    const tainted = company('c-pub', {
      externalSource: 'COMPANIES_HOUSE',
      unresolvedAliases: ['PARTNER:999'],
      recordIds: ['PARTNER:999'],
    });
    expect(
      decideCompanyMatch(
        input({ source: 'SEC_EDGAR', sourceCompanyId: 'X', domainHolders: ['c-pub'], candidates: withCandidates(tainted) }),
      ),
    ).toMatchObject({ kind: 'hold', reason: 'domain-on-unresolved-company' });
  });

  it('a domain on a row with a different Companies House number creates', () => {
    expect(
      decideCompanyMatch(
        input({
          source: 'COMPANIES_HOUSE',
          companyNumber: '00610201',
          domainHolders: ['c-1'],
          candidates: withCandidates(company('c-1', { companyNumber: '01393773' })),
        }),
      ),
    ).toMatchObject({ kind: 'create', reason: 'company-number-differs' });
  });

  it('nothing structural creates — a name is never evidence', () => {
    expect(decideCompanyMatch(input())).toMatchObject({ kind: 'create', reason: 'no-structural-match' });
  });
});

describe('companyIdentityKey', () => {
  it.each([
    ['Indigo Ag Inc.', 'indigo ag'],
    ['Indigo', 'indigo'],
    ['Acme Robotics, L.L.C.', 'acme robotics'],
    ['Société Générale SA', 'societe generale sa'],
    ['Acme Ltd', 'acme'],
    ['Acme Co', 'acme co'],
    ['Inc', 'inc'],
  ])('%s → %s', (name, key) => {
    expect(companyIdentityKey(name)).toBe(key);
  });

  it('keeps "Indigo Ag Inc." and "Indigo" apart', () => {
    expect(companyIdentityKey('Indigo Ag Inc.')).not.toBe(companyIdentityKey('Indigo'));
  });
});

describe('binding evidence', () => {
  it('is deterministic and whitelisted', () => {
    const a = bindingEvidence({
      name: 'Indigo',
      domain: 'useindigo.com',
      countryCode: 'US',
      identifiers: [
        { scheme: 'PARTNER', value: '723159' },
        { scheme: 'CIK', value: '1' },
      ],
    });
    const b = bindingEvidence({
      name: 'Indigo',
      domain: 'useindigo.com',
      countryCode: 'US',
      identifiers: [
        { scheme: 'CIK', value: '1' },
        { scheme: 'PARTNER', value: '723159' },
      ],
    });
    expect(a.hash).toBe(b.hash);
    expect(Object.keys(a.evidence).sort()).toEqual(['countryCode', 'domain', 'identifiers', 'name']);
  });

  it('canonical JSON sorts keys and stringifies BigInt', () => {
    expect(canonicalJson({ b: 1n, a: { d: 2, c: [3] } })).toBe('{"a":{"c":[3],"d":2},"b":"1"}');
  });
});
