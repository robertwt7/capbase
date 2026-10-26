import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';

import { OpsClient, OpsRequestError, type OpsTransport } from './ops-client';
import { parsePatentPage, summarizePublications } from './patent-parser';
import { applicantQuery, runPatentPilot, validatePilotOptions } from './pilot';
import { PATENT_PILOT_SAMPLE } from './sample';

const xml = readFileSync(join(__dirname, 'fixtures/biblio-search.xml'), 'utf8');
const options = { companies: 1, requests: 10, pages: 2 };

describe('patent pilot bibliography parser', () => {
  it('retains multiple applicants and exact publication kind, dates and family', () => {
    const page = parsePatentPage(xml);
    expect(page).toMatchObject({ totalResults: 2, begin: 1, end: 2, skippedRecords: 0 });
    expect(page.publications[0]).toMatchObject({
      publicationId: 'EP.1234567.A1', kind: 'A1', title: 'An example device',
      applicants: [{ name: 'EXAMPLE RESEARCH LTD', country: 'GB' }, { name: 'EXAMPLE UNIVERSITY', country: 'DE' }],
      filingDate: '2024-07-03', publicationDate: '2026-01-14', familyId: '987654',
      classifications: ['G06F 16/00', 'G 06 F 16 00'], isReviewedGrantKind: false,
    });
    expect(page.publications[1]?.isReviewedGrantKind).toBe(true);
    expect(summarizePublications([...page.publications, ...page.publications])).toEqual({
      retrievedPublications: 2, reviewedGrantKindPublications: 1, retrievedFamilies: 1,
      missingFamilyIds: 0, latestPublicationDate: '2026-10-07', sourceCoverageDate: null,
    });
  });

  it('leaves missing metadata unknown and rejects malformed identifiers', () => {
    const minimal = '<ops:world-patent-data xmlns:ops="http://ops.epo.org"><ops:biblio-search total-result-count="2"><ops:range begin="1" end="2"/><ops:search-result><exchange-documents><exchange-document country="US" doc-number="0012345" kind="B2"/><exchange-document country="XX" doc-number="bad/path" kind="B1"/></exchange-documents></ops:search-result></ops:biblio-search></ops:world-patent-data>';
    const page = parsePatentPage(minimal);
    expect(page.skippedRecords).toBe(1);
    expect(page.publications[0]).toMatchObject({ publicationId: 'US.0012345.B2', applicants: [],
      title: null, filingDate: null, publicationDate: null, familyId: null });
    expect(summarizePublications(page.publications).missingFamilyIds).toBe(1);
  });

  it('treats unsupported XML and malformed dates conservatively', () => {
    expect(() => parsePatentPage('<error>failure</error>')).toThrow('Missing OPS search result');
    expect(() => parsePatentPage('<broken>')).toThrow('Invalid OPS XML');
    expect(() => parsePatentPage('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]>')).toThrow();
    expect(() => parsePatentPage('x'.repeat(2 * 1024 * 1024 + 1))).toThrow();
    expect(parsePatentPage(xml.replace('20260114', '20260231')).publications[0]?.publicationDate).toBeNull();
  });
});

describe('bounded read-only patent pilot', () => {
  it('ships a deliberately diverse 25-company cohort with all identities unverified', () => {
    expect(PATENT_PILOT_SAMPLE).toHaveLength(25);
    expect(new Set(PATENT_PILOT_SAMPLE.map((company) => company.cohort)).size).toBe(4);
    expect(new Set(PATENT_PILOT_SAMPLE.map((company) => company.jurisdiction)).size).toBeGreaterThan(8);
    expect(PATENT_PILOT_SAMPLE.every((company) => company.identityVerified === false)).toBe(true);
  });

  it('makes no request without credentials and explicitly records unverified live access', async () => {
    const authenticate = jest.fn<() => Promise<void>>();
    const client = { authenticate, search: jest.fn<OpsClient['search']>(), requests: 0, bytes: 0 };
    const report = await runPatentPilot(options, {}, undefined, client);
    expect(authenticate).not.toHaveBeenCalled();
    expect(report).toMatchObject({ status: 'LIVE_ACCESS_UNVERIFIED', requests: 0,
      recommendation: 'NO_GO_PENDING_LIVE_EVIDENCE', sourceCoverageDate: null, companies: [] });
  });

  it('requires bounds, valid publication watermarks and safe applicant names', () => {
    for (const changes of [{ companies: 26 }, { requests: 101 }, { pages: 4 }, { companies: 0 }, { requests: NaN }, { since: '2026-02-31' }]) {
      expect(() => validatePilotOptions({ ...options, ...changes })).toThrow();
    }
    expect(applicantQuery(PATENT_PILOT_SAMPLE[0]!, '2026-10-01')).toBe('pa="Apple Inc." and pd >= 20261001');
    expect(() => applicantQuery({ ...PATENT_PILOT_SAMPLE[0]!, legalName: 'a" or pa=*' })).toThrow();
  });

  it('keeps names as candidates and compares stable IDs on repeated runs', async () => {
    const client = { authenticate: async () => undefined, search: async () => xml, requests: 1, bytes: 10 };
    const first = await runPatentPilot(options, { key: 'fixture', secret: 'fixture' }, undefined, client);
    const second = await runPatentPilot(options, { key: 'fixture', secret: 'fixture' }, first, client);
    expect(first.companies[0]?.newPublicationIds).toHaveLength(2);
    expect(second.companies[0]?.newPublicationIds).toEqual([]);
    expect(second.companies[0]?.matching).toEqual({ status: 'MANUAL_ADJUDICATION_REQUIRED', publishedLinks: 0, precision: null });
    expect(second.recommendation).toBe('NO_GO_PENDING_LIVE_EVIDENCE');
  });

  it('paginates within the hard page bound and deduplicates repeated records', async () => {
    const firstPage = xml.replace('total-result-count="2"', 'total-result-count="100"').replace('end="2"', 'end="25"');
    const secondPage = firstPage.replace('begin="1" end="25"', 'begin="26" end="50"');
    const search = jest.fn<OpsClient['search']>().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);
    const report = await runPatentPilot(options, { key: 'fixture', secret: 'fixture' }, undefined,
      { authenticate: async () => undefined, search, requests: 1, bytes: 10 });
    expect(search).toHaveBeenNthCalledWith(2, 'pa="Apple Inc."', 26, 50);
    expect(report.companies[0]?.publications).toHaveLength(2);
    expect(report.companies[0]?.truncated).toBe(true);
  });

  it('does not convert retryable source failure or missing records into zero patents', async () => {
    const report = await runPatentPilot({ ...options, companies: 25 }, { key: 'fixture', secret: 'fixture' }, undefined,
      { authenticate: async () => undefined, search: async () => { throw new OpsRequestError(503, true, 120); }, requests: 1, bytes: 0 });
    expect(report.status).toBe('SOURCE_ACCESS_FAILED');
    expect(report.companies).toHaveLength(1);
    expect(report.companies[0]).toMatchObject({ status: 'FAILED', totalSearchResults: null,
      failure: { retryable: true, retryAfterSeconds: 120 }, truncated: true });
  });

  it('records a genuine empty result as unconfirmed absence', async () => {
    const empty = '<ops:world-patent-data xmlns:ops="http://ops.epo.org"><ops:biblio-search total-result-count="0"><ops:range begin="0" end="0"/><ops:search-result/></ops:biblio-search></ops:world-patent-data>';
    const report = await runPatentPilot(options, { key: 'fixture', secret: 'fixture' }, undefined,
      { authenticate: async () => undefined, search: async () => empty, requests: 1, bytes: 0 });
    expect(report.companies[0]).toMatchObject({ status: 'NO_RESULTS_UNCONFIRMED', totalSearchResults: 0,
      truncated: false, matching: { publishedLinks: 0, precision: null } });
  });

  it('records failed access without leaking provider response bodies or credentials', async () => {
    const report = await runPatentPilot(options, { key: 'sensitive-key', secret: 'sensitive-secret' }, undefined,
      { authenticate: async () => { throw new Error('provider raw sensitive-secret'); }, search: async () => xml, requests: 1, bytes: 0 });
    expect(report.status).toBe('SOURCE_ACCESS_FAILED');
    expect(JSON.stringify(report)).not.toContain('sensitive');
    expect(report.companies).toEqual([]);
  });
});

function transport(responses: Response[]) {
  let now = 0;
  const fetchMock = jest.fn<typeof fetch>().mockImplementation(async () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected external request');
    return response;
  });
  const sleep = jest.fn<OpsTransport['sleep']>().mockImplementation(async (ms) => { now += ms; });
  return { fetch: fetchMock, sleep, now: () => now };
}

describe('EPO source transport budgets', () => {
  it('uses fixed authenticated HTTPS endpoints, no redirects and conservative spacing', async () => {
    const mock = transport([new Response('{"access_token":"fixture-token"}'), new Response(xml)]);
    const client = new OpsClient('fixture-key', 'fixture-secret', 2, mock);
    await client.authenticate();
    await client.search('pa="Apple Inc."', 1, 25);
    expect(mock.fetch.mock.calls[0]?.[0]).toBe('https://ops.epo.org/3.2/auth/accesstoken');
    expect(mock.fetch.mock.calls[1]?.[1]).toMatchObject({ redirect: 'error', headers: {
      authorization: 'Bearer fixture-token', 'X-OPS-Range': '1-25', accept: 'application/exchange+xml',
    } });
    expect(mock.sleep).toHaveBeenCalledWith(1000);
    await expect(client.search('pa=x', 26, 50)).rejects.toThrow('request limit');
    expect(client.requests).toBe(2);
  });

  it('counts retryable responses against limits and honours Retry-After', async () => {
    const mock = transport([new Response('', { status: 429, headers: { 'retry-after': '3' } }), new Response('{"access_token":"fixture"}')]);
    const client = new OpsClient('fixture', 'fixture', 2, mock);
    await client.authenticate();
    expect(client.requests).toBe(2);
    expect(mock.sleep).toHaveBeenCalledWith(3000);
  });

  it('stops instead of sleeping past long provider throttles', async () => {
    const mock = transport([new Response('', { status: 503, headers: { 'retry-after': '120' } })]);
    await expect(new OpsClient('fixture', 'fixture', 2, mock).authenticate()).rejects.toMatchObject({ status: 503, retryable: true, retryAfterSeconds: 120 });
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized decompressed responses and unsupported ranges', async () => {
    const mock = transport([new Response('x'.repeat(2 * 1024 * 1024 + 1))]);
    await expect(new OpsClient('fixture', 'fixture', 2, mock).authenticate()).rejects.toThrow('byte limit');
    const valid = new OpsClient('fixture', 'fixture', 2, transport([new Response('{"access_token":"fixture"}')]));
    await valid.authenticate();
    await expect(valid.search('pa=x', 0, 25)).rejects.toThrow('range');
    await expect(valid.search('pa=x', 1, 101)).rejects.toThrow('range');
  });
});
