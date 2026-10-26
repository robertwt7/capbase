import { gzipSync } from 'node:zlib';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { LookupFunction } from 'node:net';

import { isPublicAddress, MAX_HTML_BYTES, pinnedTransport, readBoundedBody, SafeWebsiteFetcher, validateFetchUrl } from './safe-fetch';
import type { PinnedRequest, WireResponse } from './safe-fetch';

const publicAddress = { address: '93.184.216.34', family: 4 };
function wire(status = 200, body: string | Buffer = '<html><body>Company</body></html>', headers: Record<string, string> = { 'content-type': 'text/html' }): WireResponse {
  return { status, headers, body: (async function* () { yield Buffer.from(body); })(), destroy: jest.fn() };
}
let sequence = 0;
function harness(responses: WireResponse[], options: { requestTimeoutMs?: number; siteTimeoutMs?: number } = {}) {
  const requests: PinnedRequest[] = [];
  const resolve = jest.fn(async () => [publicAddress]);
  const transport = jest.fn(async (request: PinnedRequest) => {
    requests.push(request);
    const response = responses.shift();
    if (!response) throw new Error('Unexpected request');
    return response;
  });
  const fetcher = new SafeWebsiteFetcher({ minHostIntervalMs: 0, ...options }, { resolve, transport });
  const url = `https://test${sequence++}.example.com/`;
  return { fetcher, url, requests, resolve, transport };
}

describe('safe public website fetch', () => {
  it.each(['127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.1.1', '192.168.1.1', '169.254.169.254', '100.64.1.1', '192.0.2.1', '224.0.0.1', '240.0.0.1', '::1', '::', 'fc00::1', 'fe80::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1'])('rejects nonpublic address %s', (address) => expect(isPublicAddress(address)).toBe(false));
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('accepts public address %s', (address) => expect(isPublicAddress(address)).toBe(true));
  it.each(['file:///etc/passwd', 'http://user:secret@example.com/', 'https://example.com:8443/', 'http://2130706433/', 'http://0x7f000001/', 'http://[::ffff:127.0.0.1]/', 'http://localhost/', 'https://example.com./'])('rejects unsafe URL %s', (url) => expect(() => validateFetchUrl(url)).toThrow());
  it('pins a DNS-approved address on both requests and resolves again after robots', async () => {
    const h = harness([wire(404), wire()]);
    expect((await h.fetcher.fetch(h.url)).outcome).toBe('SUCCESS');
    expect(h.resolve).toHaveBeenCalledTimes(2);
    expect(h.requests.map((request) => request.address)).toEqual([publicAddress, publicAddress]);
    expect(h.requests[0]!.url.pathname).toBe('/robots.txt');
    expect(h.requests[1]!.url.hostname).toBe(new URL(h.url).hostname);
  });
  it('rejects DNS rebinding between robots and homepage before making the unsafe connection', async () => {
    const h = harness([wire(404)]);
    h.resolve.mockResolvedValueOnce([publicAddress]).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    expect((await h.fetcher.fetch(h.url)).outcome).toBe('INVALID_TARGET');
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('rejects mixed public/private DNS answers', async () => {
    const h = harness([]);
    h.resolve.mockResolvedValueOnce([publicAddress, { address: '10.0.0.1', family: 4 }]);
    expect((await h.fetcher.fetch(h.url)).outcome).toBe('INVALID_TARGET');
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('rejects public to private redirects before sending any private request', async () => {
    const h = harness([wire(404), wire(302, '', { location: 'http://169.254.169.254/latest/meta-data/' })]);
    expect((await h.fetcher.fetch(h.url)).outcome).toBe('INVALID_TARGET');
    expect(h.transport).toHaveBeenCalledTimes(2);
  });
  it('quarantines unrelated registrable domains, including co.uk boundaries', async () => {
    const h = harness([wire(404), wire(302, '', { location: 'https://other.co.uk/' })]);
    expect((await h.fetcher.fetch('https://company.co.uk/')).outcome).toBe('BLOCKED');
    expect(h.transport).toHaveBeenCalledTimes(2);
  });
  it('keeps private public-suffix tenants separate', async () => {
    const h = harness([wire(404), wire(302, '', { location: 'https://unrelated.github.io/' })]);
    expect((await h.fetcher.fetch('https://company.github.io/')).outcome).toBe('BLOCKED');
  });
  it('accepts same registrable domain redirects and checks robots on the new origin', async () => {
    const h = harness([wire(404), wire(301, '', { location: 'https://www.same-site.co.uk/' }), wire(404), wire()]);
    expect((await h.fetcher.fetch('https://same-site.co.uk/')).outcome).toBe('SUCCESS');
    expect(h.requests.map((r) => r.url.pathname)).toEqual(['/robots.txt', '/', '/robots.txt', '/']);
  });
  it('limits homepage redirects to three', async () => {
    const redirect = () => wire(302, '', { location: '/again' });
    const h = harness([wire(404), redirect(), redirect(), redirect(), redirect()]);
    expect((await h.fetcher.fetch(h.url)).outcome).toBe('UNSUPPORTED');
    expect(h.transport).toHaveBeenCalledTimes(5);
  });
  it('respects robots disallow without fetching the page', async () => {
    const h = harness([wire(200, 'User-agent: CapbaseBot\nDisallow: /', { 'content-type': 'text/plain' })]);
    expect((await h.fetcher.fetch(h.url)).outcome).toBe('ROBOTS_DENIED');
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it.each([429, 500, 503])('defers on robots HTTP %s rather than treating as absence', async (status) => {
    const h = harness([wire(status, '', { 'retry-after': '3600' })]);
    expect(await h.fetcher.fetch(h.url)).toEqual({ outcome: 'RETRYABLE_ERROR', retryAfterMs: 3_600_000 });
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('defers an excessive crawl-delay rather than ignoring it', async () => {
    const h = harness([wire(200, 'User-agent: *\nCrawl-delay: 60', { 'content-type': 'text/plain' })]);
    expect(await h.fetcher.fetch(h.url)).toEqual({ outcome: 'RETRYABLE_ERROR', retryAfterMs: 60_000 });
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('times out DNS and robots without hanging', async () => {
    const h = harness([], { requestTimeoutMs: 10 });
    h.resolve.mockImplementation(() => new Promise(() => {}));
    expect((await h.fetcher.fetch(h.url)).outcome).toBe('RETRYABLE_ERROR');
  });
  it('times out stalled body consumption and destroys the stream', async () => {
    const response = wire();
    response.body = (async function* () { await new Promise(() => {}); yield Buffer.from(''); })();
    const h = harness([wire(404), response], { requestTimeoutMs: 10 });
    expect((await h.fetcher.fetch(h.url)).outcome).toBe('RETRYABLE_ERROR');
    expect(response.destroy).toHaveBeenCalled();
  });
  it('enforces the overall site deadline even with a hanging transport', async () => {
    const h = harness([], { requestTimeoutMs: 100, siteTimeoutMs: 10 });
    h.transport.mockImplementation(() => new Promise(() => {}));
    expect((await h.fetcher.fetch(h.url)).outcome).toBe('RETRYABLE_ERROR');
  });
  it.each([
    wire(200, Buffer.alloc(MAX_HTML_BYTES + 1)),
    wire(200, gzipSync(Buffer.alloc(MAX_HTML_BYTES + 1)), { 'content-type': 'text/html', 'content-encoding': 'gzip' }),
    wire(200, 'PDF bytes', { 'content-type': 'application/pdf' }),
    wire(200, '<html></html>', { 'content-type': 'text/html', 'content-encoding': 'unknown' }),
  ])('rejects oversized or unsupported representations', async (response) => {
    const h = harness([wire(404), response]);
    expect((await h.fetcher.fetch(h.url)).outcome).toBe('UNSUPPORTED');
  });
  it('decodes supported gzip within bounds', async () => {
    const html = '<html><body>Company</body></html>';
    const response = wire(200, gzipSync(html), { 'content-encoding': 'gzip' });
    expect(await readBoundedBody(response, MAX_HTML_BYTES, new AbortController().signal)).toBe(html);
    expect(response.destroy).toHaveBeenCalled();
  });
  it.each(['<title>Just a moment...</title>', '<html>This domain is for sale</html>', '<html><title>Log in</title></html>'])('does not count challenge/parked/login page as absence', async (html) => {
    const h = harness([wire(404), wire(200, html)]);
    expect((await h.fetcher.fetch(h.url)).outcome).toBe('BLOCKED');
  });
  it('destroys ignored redirect and error bodies', async () => {
    const robots = wire(404);
    const page = wire(503);
    const h = harness([robots, page]);
    expect((await h.fetcher.fetch(h.url)).outcome).toBe('RETRYABLE_ERROR');
    expect(robots.destroy).toHaveBeenCalled();
    expect(page.destroy).toHaveBeenCalled();
  });
});

it('limits concurrent sites globally to two', async () => {
  let active = 0;
  let peak = 0;
  const fetcher = new SafeWebsiteFetcher({ minHostIntervalMs: 0 }, {
    resolve: async () => [publicAddress],
    transport: async ({ url }) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return url.pathname === '/robots.txt' ? wire(404) : wire();
    },
  });
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) => fetcher.fetch(`https://concurrency${index}.example.com/`)));
  expect(results.every((result) => result.outcome === 'SUCCESS')).toBe(true);
  expect(peak).toBe(2);
});

it('spaces host requests by at least one second and respects a longer robots crawl-delay', async () => {
  let now = 1_000_000;
  const times: number[] = [];
  const sleep = jest.fn(async (ms: number) => { now += ms; });
  const fetcher = new SafeWebsiteFetcher({ minHostIntervalMs: 1000 }, {
    now: () => now,
    sleep,
    resolve: async () => [publicAddress],
    transport: async ({ url }) => {
      times.push(now);
      return url.pathname === '/robots.txt' ? wire(200, 'User-agent: *\nCrawl-delay: 2', { 'content-type': 'text/plain' }) : wire();
    },
  });
  expect((await fetcher.fetch('https://throttle-test.example.com/')).outcome).toBe('SUCCESS');
  expect(times).toEqual([1_000_000, 1_002_000]);
  expect(sleep).toHaveBeenCalledWith(2000, expect.any(AbortSignal));
});


it('native transport keeps original Host and returns only the approved IP from socket lookup', async () => {
  const response = new PassThrough() as unknown as http.IncomingMessage;
  response.statusCode = 200;
  response.headers = { 'content-type': 'text/html', 'set-cookie': ['private-token=secret'], server: 'private-server' };
  const req = new EventEmitter() as http.ClientRequest;
  req.end = jest.fn(() => req);
  const spy = jest.spyOn(http, 'request').mockImplementation((url, options, callback) => {
    expect(String(url)).toBe('http://original.example.com/');
    const lookup = options.lookup as LookupFunction;
    lookup('original.example.com', {}, (_err, address, family) => {
      expect(address).toBe(publicAddress.address);
      expect(family).toBe(4);
    });
    expect(options.agent).toBe(false);
    expect(options.family).toBe(4);
    queueMicrotask(() => callback?.(response));
    return req;
  });
  try {
    const result = await pinnedTransport({ url: new URL('http://original.example.com/'), address: publicAddress, userAgent: 'CapbaseBot/1.0', signal: new AbortController().signal });
    expect(result.headers).toEqual({ 'content-type': 'text/html' });
    result.destroy();
    expect(response.destroyed).toBe(true);
  } finally { spy.mockRestore(); }
});
