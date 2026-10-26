import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import robotsParser from 'robots-parser';
import { getDomain } from 'tldts';

import { isBlockedPage } from './website-detector';

export const MAX_HTML_BYTES = 1_048_576;
export type FetchFailure = 'BLOCKED' | 'ROBOTS_DENIED' | 'RETRYABLE_ERROR' | 'INVALID_TARGET' | 'UNSUPPORTED';
export type WebsiteFetchResult =
  | { outcome: 'SUCCESS'; html: string; headers: Record<string, string>; finalUrl: string; retryAfterMs?: number }
  | { outcome: FetchFailure; retryAfterMs?: number };
export interface ResolvedAddress { address: string; family: number }
export interface PinnedRequest {
  url: URL;
  address: ResolvedAddress;
  userAgent: string;
  signal: AbortSignal;
}
export interface WireResponse {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
  destroy: () => void;
  signal?: AbortSignal;
}
export interface SafeFetchDependencies {
  resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  transport: (request: PinnedRequest) => Promise<WireResponse>;
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}
export interface SafeFetchOptions {
  userAgent?: string;
  requestTimeoutMs?: number;
  siteTimeoutMs?: number;
  minHostIntervalMs?: number;
}
class FetchError extends Error {
  constructor(readonly outcome: FetchFailure, readonly retryAfterMs?: number) { super(outcome); }
}

/** Only globally routable unicast addresses. Mapped IPv4 is classified as IPv4. */
export function isPublicAddress(raw: string): boolean {
  try { return ipaddr.process(raw).range() === 'unicast'; } catch { return false; }
}

export function validateFetchUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new FetchError('INVALID_TARGET'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) {
    throw new FetchError('INVALID_TARGET');
  }
  url.hash = '';
  // URL canonicalizes decimal/hex/octal IPv4 before the network policy runs.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host.endsWith('.') || (isIP(host) && !isPublicAddress(host))) throw new FetchError('INVALID_TARGET');
  if (!isIP(host) && !getDomain(host, { allowPrivateDomains: true })) throw new FetchError('INVALID_TARGET');
  return url;
}

function sameSite(a: URL, b: URL): boolean {
  const options = { allowPrivateDomains: true };
  const domain = getDomain(a.hostname, options);
  return domain ? domain === getDomain(b.hostname, options) : a.hostname === b.hostname;
}

/** Native request receives the validated hostname for Host/SNI/certificate checks,
 * but its lookup callback can return ONLY the previously approved address. No proxy,
 * cookie jar, automatic redirects, connection reuse, or second DNS lookup. */
export function pinnedTransport({ url, address, userAgent, signal }: PinnedRequest): Promise<WireResponse> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(url, {
      agent: false,
      signal,
      maxHeaderSize: 16_384,
      family: address.family,
      headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,text/plain;q=0.5', 'accept-encoding': 'gzip, deflate, br' },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (res) => {
      const headers: Record<string, string> = {};
      // No Set-Cookie/auth/arbitrary response headers survive this boundary.
      for (const name of ['content-type', 'content-encoding', 'location', 'retry-after']) {
        const value = res.headers[name];
        if (typeof value === 'string') headers[name] = value;
      }
      resolve({ status: res.statusCode ?? 0, headers, body: res, destroy: () => res.destroy() });
    });
    req.once('error', reject);
    req.end();
  });
}

/** Bounds both wire and decompressed bytes. pipeline destroys upstream and decoder
 * on oversize, corrupt compression, abort or early close. */
export async function readBoundedBody(response: WireResponse, maxBytes: number, signal: AbortSignal): Promise<string> {
  const encoding = (response.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
  const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : null;
  if (encoding !== 'identity' && !decoder) { response.destroy(); throw new FetchError('UNSUPPORTED'); }
  let wireBytes = 0;
  let decodedBytes = 0;
  const chunks: Buffer[] = [];
  const wireLimit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    wireBytes += chunk.length;
    callback(wireBytes > maxBytes ? new FetchError('UNSUPPORTED') : null, chunk);
  } });
  const sink = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    decodedBytes += chunk.length;
    if (decodedBytes > maxBytes) { callback(new FetchError('UNSUPPORTED')); return; }
    chunks.push(chunk);
    callback();
  } });
  try {
    const source = Readable.from(response.body);
    if (decoder) await abortable(pipeline(source, wireLimit, decoder, sink, { signal }), signal);
    else await abortable(pipeline(source, wireLimit, sink, { signal }), signal);
    return Buffer.concat(chunks).toString('utf8');
  } finally { response.destroy(); }
}

function retryAfter(headers: Record<string, string>, now: number): number | undefined {
  const value = headers['retry-after'];
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error('Aborted'));
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

// Shared by every fetcher instance. Bound the number of live sites to two.
let activeSites = 0;
const siteWaiters: (() => void)[] = [];
async function acquireSite(): Promise<() => void> {
  if (activeSites >= 2) await new Promise<void>((resolve) => siteWaiters.push(resolve));
  else activeSites++;
  return () => { const next = siteWaiters.shift(); if (next) next(); else activeSites--; };
}
// A host's next permitted request includes robots requests and redirect hops.
const hostTurns = new Map<string, { next: number; last: number; tail: Promise<void> }>();

export class SafeWebsiteFetcher {
  private readonly options: Required<SafeFetchOptions>;
  private readonly deps: SafeFetchDependencies;
  constructor(options: SafeFetchOptions = {}, dependencies: Partial<SafeFetchDependencies> = {}) {
    this.options = {
      userAgent: options.userAgent ?? 'CapbaseBot/1.0 (+https://capbase.fyi/data)',
      requestTimeoutMs: Math.min(options.requestTimeoutMs ?? 10_000, 10_000),
      siteTimeoutMs: Math.min(options.siteTimeoutMs ?? 30_000, 30_000),
      minHostIntervalMs: Math.max(options.minHostIntervalMs ?? 1000, dependencies.transport ? 0 : 1000),
    };
    this.deps = {
      resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
      transport: pinnedTransport,
      now: Date.now,
      sleep: async (ms, signal) => { await delay(ms, undefined, { signal }); },
      ...dependencies,
    };
  }

  async fetch(targetUrl: string, externalSignal?: AbortSignal): Promise<WebsiteFetchResult> {
    const release = await acquireSite();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Site deadline')), this.options.siteTimeoutMs);
    const signal = externalSignal ? AbortSignal.any([externalSignal, controller.signal]) : controller.signal;
    try {
      const original = validateFetchUrl(targetUrl);
      const policies = new Map<string, ReturnType<typeof robotsParser> | null>();
      let url = original;
      for (let redirects = 0; redirects <= 3; redirects++) {
        const policy = await this.policy(url, original, policies, signal);
        if (policy?.isAllowed(url.href, this.options.userAgent) === false) throw new FetchError('ROBOTS_DENIED');
        const crawlDelay = (policy?.getCrawlDelay(this.options.userAgent) ?? 0) * 1000;
        if (crawlDelay > this.options.siteTimeoutMs) throw new FetchError('RETRYABLE_ERROR', crawlDelay);
        const response = await this.request(url, signal, crawlDelay);
        const retry = retryAfter(response.headers, this.deps.now());
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          response.destroy();
          if (redirects === 3 || !response.headers.location) throw new FetchError('UNSUPPORTED');
          url = validateFetchUrl(new URL(response.headers.location, url).href);
          if (!sameSite(original, url)) throw new FetchError('BLOCKED');
          continue;
        }
        if (response.status === 429 || response.status >= 500) { response.destroy(); throw new FetchError('RETRYABLE_ERROR', retry); }
        if (response.status === 401 || response.status === 403) { response.destroy(); throw new FetchError('BLOCKED', retry); }
        if (response.status < 200 || response.status >= 300) { response.destroy(); throw new FetchError('UNSUPPORTED'); }
        if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers['content-type'] ?? '')) {
          response.destroy(); throw new FetchError('UNSUPPORTED');
        }
        const html = await this.consume(response, MAX_HTML_BYTES, signal);
        if (isBlockedPage(html)) throw new FetchError('BLOCKED');
        if (!/<(?:!doctype\s+html|html|head|body|meta|script|main|div|p|a)(?:\s|>)/i.test(html)) throw new FetchError('UNSUPPORTED');
        return { outcome: 'SUCCESS', html, headers: response.headers, finalUrl: url.href };
      }
      return { outcome: 'UNSUPPORTED' };
    } catch (err) {
      return err instanceof FetchError ? { outcome: err.outcome, ...(err.retryAfterMs ? { retryAfterMs: err.retryAfterMs } : {}) } : { outcome: 'RETRYABLE_ERROR' };
    } finally { clearTimeout(timer); release(); }
  }

  private async consume(response: WireResponse, max: number, siteSignal: AbortSignal): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Body timeout')), this.options.requestTimeoutMs);
    try { return await readBoundedBody(response, max, AbortSignal.any([siteSignal, controller.signal, ...(response.signal ? [response.signal] : [])])); }
    finally { clearTimeout(timer); }
  }

  private async request(url: URL, signal: AbortSignal, crawlDelay = 0): Promise<WireResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Request timeout')), this.options.requestTimeoutMs);
    const combined = AbortSignal.any([signal, controller.signal]);
    let handedOff = false;
    try {
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await abortable(this.deps.resolve(hostname), combined);
      // Reject the whole DNS response when any answer is unsafe; never fall back.
      if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address) || ![4, 6].includes(entry.family))) throw new FetchError('INVALID_TARGET');
      const address = addresses[0]!;
      let turn = hostTurns.get(hostname);
      if (!turn) {
        // Completed old hosts may be evicted; active chains are retained.
        if (hostTurns.size >= 10_000) for (const [key, value] of hostTurns) { if (value.next < this.deps.now() - 60_000) hostTurns.delete(key); }
        turn = { next: 0, last: 0, tail: Promise.resolve() };
        hostTurns.set(hostname, turn);
      }
      const previous = turn.tail;
      let unlock!: () => void;
      turn.tail = new Promise<void>((resolve) => { unlock = resolve; });
      try {
        await abortable(previous, combined);
        const wait = Math.max(0, Math.max(turn.next, turn.last ? turn.last + crawlDelay : 0) - this.deps.now());
        if (wait) await this.deps.sleep(wait, combined);
        turn.last = this.deps.now();
        turn.next = turn.last + Math.max(this.options.minHostIntervalMs, crawlDelay);
        // transport resolves headers; consume has its own timeout, bounded by site deadline.
        const response = await abortable(this.deps.transport({ url, address, userAgent: this.options.userAgent, signal: combined }), combined);
        handedOff = true;
        return { ...response, signal: combined, destroy: () => { clearTimeout(timer); response.destroy(); } };
      } finally { unlock(); }
    } finally { if (!handedOff) clearTimeout(timer); }
  }

  private async policy(url: URL, original: URL, policies: Map<string, ReturnType<typeof robotsParser> | null>, signal: AbortSignal): Promise<ReturnType<typeof robotsParser> | null> {
    if (policies.has(url.origin)) return policies.get(url.origin)!;
    let robotsUrl = new URL('/robots.txt', url);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await this.request(robotsUrl, signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        response.destroy();
        if (redirects === 3 || !response.headers.location) throw new FetchError('RETRYABLE_ERROR');
        robotsUrl = validateFetchUrl(new URL(response.headers.location, robotsUrl).href);
        if (!sameSite(original, robotsUrl)) throw new FetchError('BLOCKED');
        continue;
      }
      if (response.status === 404) { response.destroy(); policies.set(url.origin, null); return null; }
      const retry = retryAfter(response.headers, this.deps.now());
      if ([401, 403].includes(response.status)) { response.destroy(); throw new FetchError('ROBOTS_DENIED', retry); }
      if (response.status < 200 || response.status >= 300) { response.destroy(); throw new FetchError('RETRYABLE_ERROR', retry); }
      const body = await this.consume(response, 65_536, signal);
      if (/<(?:html|!doctype)/i.test(body) || isBlockedPage(body)) throw new FetchError('RETRYABLE_ERROR');
      const policy = robotsParser(new URL('/robots.txt', url).href, body);
      policies.set(url.origin, policy);
      return policy;
    }
    throw new FetchError('RETRYABLE_ERROR');
  }
}
