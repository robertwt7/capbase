import { describe, it, expect } from '@jest/globals';

import { hostnameOf, mapWikidata, sectorFor, type WikidataBundle } from './wikidata.mapper';

const uri = (qid: string) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${qid}` });
const lit = (value: string) => ({ type: 'literal', value });

function bundle(overrides: Partial<WikidataBundle> = {}): WikidataBundle {
  return { details: [], investors: [], people: [], acquisitions: [], exits: [], ...overrides };
}

const STRIPE_DETAILS = {
  company: uri('Q1'),
  companyLabel: lit('Stripe'),
  companyDescription: lit('payment services company'),
  website: lit('https://www.stripe.com'),
  inception: lit('2010-01-01T00:00:00Z'),
  hqLabel: lit('South San Francisco'),
  countryLabel: lit('United States of America'),
  industryLabel: lit('financial technology'),
  employees: lit('7000'),
  linkedinId: lit('stripe'),
};

describe('mapWikidata', () => {
  it('maps a full company row to a normalized record', () => {
    const records = mapWikidata(
      bundle({
        details: [STRIPE_DETAILS],
        investors: [
          {
            company: uri('Q1'),
            investor: uri('Q20'),
            investorLabel: lit('Sequoia Capital'),
            class: uri('Q3487908'),
          },
        ],
        people: [
          { company: uri('Q1'), person: uri('Q30'), personLabel: lit('Patrick Collison'), role: lit('Founder') },
          {
            company: uri('Q1'),
            person: uri('Q30'),
            personLabel: lit('Patrick Collison'),
            role: lit('CEO'),
            start: lit('2011-06-01T00:00:00Z'),
          },
        ],
      }),
    );

    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r.source).toBe('WIKIDATA');
    expect(r.companyExternalId).toBe('Q1');
    expect(r.round).toBeUndefined();
    expect(r.company).toMatchObject({
      name: 'Stripe',
      domain: 'stripe.com',
      websiteUrl: 'https://www.stripe.com',
      linkedinUrl: 'https://www.linkedin.com/company/stripe',
      foundedYear: 2010,
      headcount: 7000,
      hq: 'South San Francisco, United States of America',
      industry: ['financial technology'],
      primarySector: 'Fintech',
      status: 'Private',
      stage: 'Late stage',
      totalRaisedUsd: 0,
      oneLiner: 'Payment services company',
    });
    expect(r.investors).toEqual([
      {
        externalId: 'Q1:investor:Q20',
        investorExternalId: 'Q20',
        name: 'Sequoia Capital',
        type: 'Venture',
        firstRound: 'Undisclosed',
        rounds: 1,
      },
    ]);
    expect(r.people).toEqual([
      { externalId: 'Q1:person:Q30:Founder', name: 'Patrick Collison', role: 'Founder', since: 2010 },
      { externalId: 'Q1:person:Q30:CEO', name: 'Patrick Collison', role: 'CEO', since: 2011 },
    ]);
  });

  it('skips companies whose English label is missing (bare QID label)', () => {
    const records = mapWikidata(
      bundle({ details: [{ company: uri('Q999'), companyLabel: lit('Q999') }] }),
    );
    expect(records).toEqual([]);
  });

  it('dedupes multi-valued detail rows first-wins', () => {
    const records = mapWikidata(
      bundle({
        details: [
          STRIPE_DETAILS,
          { ...STRIPE_DETAILS, website: lit('https://stripe.dev') },
        ],
        investors: [
          { company: uri('Q1'), investor: uri('Q20'), investorLabel: lit('Sequoia Capital') },
          { company: uri('Q1'), investor: uri('Q20'), investorLabel: lit('Sequoia Capital') },
        ],
      }),
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.company.domain).toBe('stripe.com');
    expect(records[0]!.investors).toHaveLength(1);
  });

  it('types investors from their P31 class, not their name', () => {
    const records = mapWikidata(
      bundle({
        details: [STRIPE_DETAILS],
        investors: [
          // Name says nothing; the class decides.
          { company: uri('Q1'), investor: uri('Q21'), investorLabel: lit('Y Combinator'), class: uri('Q4086495') },
          { company: uri('Q1'), investor: uri('Q22'), investorLabel: lit('Blackstone'), class: uri('Q5418962') },
          { company: uri('Q1'), investor: uri('Q23'), investorLabel: lit('Jane Doe'), class: uri('Q5') },
          { company: uri('Q1'), investor: uri('Q24'), investorLabel: lit('Temasek'), class: uri('Q1061648') },
        ],
      }),
    );
    expect(records[0]!.investors!.map((i) => [i.name, i.type])).toEqual([
      ['Y Combinator', 'Accelerator'],
      ['Blackstone', 'Private equity'],
      ['Jane Doe', 'Angel'],
      ['Temasek', 'Sovereign wealth'],
    ]);
  });

  it('collects classes across rows and falls back to Venture when none is usable', () => {
    const records = mapWikidata(
      bundle({
        details: [STRIPE_DETAILS],
        investors: [
          // One row per P31 value — the specific class must win over the generic.
          { company: uri('Q1'), investor: uri('Q25'), investorLabel: lit('Index Ventures'), class: uri('Q4830453') },
          { company: uri('Q1'), investor: uri('Q25'), investorLabel: lit('Index Ventures'), class: uri('Q3487908') },
          // No class at all — the query's OPTIONAL left it unbound.
          { company: uri('Q1'), investor: uri('Q26'), investorLabel: lit('Unknown Backer') },
        ],
      }),
    );
    const investors = records[0]!.investors!;
    expect(investors).toHaveLength(2);
    expect(investors[0]).toMatchObject({ name: 'Index Ventures', type: 'Venture', investorExternalId: 'Q25' });
    expect(investors[1]).toMatchObject({ name: 'Unknown Backer', type: 'Venture', investorExternalId: 'Q26' });
  });

  it('derives Public status/stage from an IPO exit (earliest dated row wins)', () => {
    const records = mapWikidata(
      bundle({
        details: [STRIPE_DETAILS],
        exits: [
          { company: uri('Q1'), kind: lit('ipo'), date: lit('2026-03-03T00:00:00Z') },
          { company: uri('Q1'), kind: lit('ipo'), date: lit('2025-09-09T00:00:00Z') },
          { company: uri('Q1'), kind: lit('ipo') },
        ],
      }),
    );
    const r = records[0]!;
    expect(r.company.status).toBe('Public');
    expect(r.company.stage).toBe('Public');
    expect(r.exits).toEqual([
      {
        externalId: 'Q1:exit:ipo',
        type: 'IPO',
        date: '2025-09-09',
        valueUsd: null,
        detail: 'Initial public offering.',
      },
    ]);
  });

  it('derives Acquired status/stage from an acquisition exit', () => {
    const records = mapWikidata(
      bundle({
        details: [STRIPE_DETAILS],
        exits: [
          {
            company: uri('Q1'),
            kind: lit('acq'),
            acquirer: uri('Q50'),
            acquirerLabel: lit('BigCorp'),
            date: lit('2024-04-04T00:00:00Z'),
          },
        ],
      }),
    );
    const r = records[0]!;
    expect(r.company.status).toBe('Acquired');
    expect(r.company.stage).toBe('Acquired');
    expect(r.exits).toEqual([
      {
        externalId: 'Q1:exit:acq:Q50',
        type: 'Acquisition',
        date: '2024-04-04',
        valueUsd: null,
        detail: 'Acquired by BigCorp.',
      },
    ]);
  });

  it('keeps only dated, labeled acquisition targets', () => {
    const records = mapWikidata(
      bundle({
        details: [STRIPE_DETAILS],
        acquisitions: [
          { company: uri('Q1'), target: uri('Q60'), targetLabel: lit('Paystack'), date: lit('2020-10-15T00:00:00Z') },
          { company: uri('Q1'), target: uri('Q61'), targetLabel: lit('Q61'), date: lit('2021-01-01T00:00:00Z') },
          { company: uri('Q1'), target: uri('Q62'), targetLabel: lit('Undated Co') },
        ],
      }),
    );
    expect(records[0]!.acquisitions).toEqual([
      {
        externalId: 'Q1:acq:Q60',
        target: 'Paystack',
        date: '2020-10-15',
        amountUsd: null,
        rationale: 'Acquisition recorded on Wikidata.',
      },
    ]);
  });

  it('falls back to a templated one-liner and Undisclosed HQ', () => {
    const records = mapWikidata(
      bundle({ details: [{ company: uri('Q2'), companyLabel: lit('Mystery Co') }] }),
    );
    const r = records[0]!;
    expect(r.company.oneLiner).toBe('Mystery Co — profile sourced from Wikidata.');
    expect(r.company.hq).toBe('Undisclosed');
    expect(r.company.foundedYear).toBe(0);
    expect(r.company.domain).toBe('');
    expect(r.company.primarySector).toBeNull();
  });
});

describe('sectorFor', () => {
  it.each([
    ['artificial intelligence research lab', 'Artificial intelligence'],
    ['machine learning tooling', 'Artificial intelligence'],
    // Ordering: specific fintech terms beat the broad financial bucket…
    ['payment processing', 'Fintech'],
    // …but bare banking/finance terms land in Financial services.
    ['digital bank', 'Financial services'],
    ['investment management firm', 'Financial services'],
    ['biotech therapeutics', 'Healthcare'],
    // Ordering: renewables beat the generic energy bucket.
    ['solar panels', 'Climate'],
    ['solar energy developer', 'Climate'],
    ['oil and gas exploration', 'Energy'],
    ['sewer network operator', 'Energy'],
    ['cloud software', 'Enterprise SaaS'],
    ['real estate developer', 'Real estate'],
    ['urban planning consultancy', 'Real estate'],
    ['space logistics', 'Transport'],
    ['hotel chain', 'Consumer & retail'],
    ['telecommunications carrier', 'Media & telecom'],
    ['university spin-off in education', 'Education'],
    ['agriculture, forestry and fishing', 'Industrials'],
    ['consumer electronics', 'Consumer & retail'],
    ['electronics maker', 'Technology'],
    ['zebra grooming services', null],
  ])('%s → %s', (text, expected) => {
    expect(sectorFor(text)).toBe(expected);
  });
});

describe('hostnameOf', () => {
  it.each([
    ['https://www.stripe.com', 'stripe.com'],
    ['https://openai.com/about', 'openai.com'],
    ['not a url', ''],
    [null, ''],
  ])('%s → %s', (url, expected) => {
    expect(hostnameOf(url)).toBe(expected);
  });
});

describe('mapWikidata identifiers', () => {
  const listing = (ticker: string, exchange: string) => ({
    ...STRIPE_DETAILS,
    ticker: lit(ticker),
    exchangeLabel: lit(exchange),
  });

  it('always emits the QID it queried by', () => {
    const r = mapWikidata(bundle({ details: [STRIPE_DETAILS] }))[0]!;
    expect(r.company.identifiers).toEqual([{ scheme: 'WIKIDATA', value: 'Q1' }]);
  });

  it('collects the LEI and CIK when the entity carries them', () => {
    const r = mapWikidata(
      bundle({
        details: [
          { ...STRIPE_DETAILS, lei: lit('HWUPKR0MPOU8FGXBT394'), cik: lit('0000320193') },
        ],
      }),
    )[0]!;
    expect(r.company.identifiers).toEqual([
      { scheme: 'WIKIDATA', value: 'Q1' },
      { scheme: 'LEI', value: 'HWUPKR0MPOU8FGXBT394' },
      { scheme: 'CIK', value: '0000320193' },
    ]);
  });

  it('accumulates identifiers across the repeated rows one QID produces', () => {
    // Each multi-valued property produces its own row. The record builder takes
    // the FIRST row for its scalar fields, so reading identifiers off that row
    // alone would silently lose every listing but one.
    const r = mapWikidata(
      bundle({
        details: [listing('ABNB', 'Nasdaq'), listing('ABNB', 'New York Stock Exchange')],
      }),
    )[0]!;
    expect(r.company.identifiers).toEqual([
      { scheme: 'WIKIDATA', value: 'Q1' },
      { scheme: 'TICKER', value: 'NASDAQ:ABNB' },
      { scheme: 'TICKER', value: 'NYSE:ABNB' },
    ]);
  });

  it('drops a ticker whose statement names no exchange', () => {
    const r = mapWikidata(
      bundle({ details: [{ ...STRIPE_DETAILS, ticker: lit('ABNB') }] }),
    )[0]!;
    expect(r.company.identifiers).toEqual([{ scheme: 'WIKIDATA', value: 'Q1' }]);
  });

  it('does not repeat an identifier that appears on several rows', () => {
    const r = mapWikidata(
      bundle({
        details: [
          { ...STRIPE_DETAILS, lei: lit('HWUPKR0MPOU8FGXBT394') },
          { ...STRIPE_DETAILS, lei: lit('HWUPKR0MPOU8FGXBT394') },
        ],
      }),
    )[0]!;
    expect(r.company.identifiers).toHaveLength(2);
  });
});
