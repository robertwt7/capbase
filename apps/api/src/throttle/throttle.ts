import { createHash } from 'node:crypto';

import type { ExecutionContext } from '@nestjs/common';
import { Throttle, type ThrottlerOptions } from '@nestjs/throttler';
import { API_KEY_DAILY_LIMITS, API_KEY_LIMITS, type ApiKeyScope } from '@repo/api';

/**
 * App-level rate limits. nginx is the front line (per-IP zones in
 * infra/nginx/conf.d/capbase.conf); these are the backstop for a caller that
 * reaches the API without it, and the only limits that can key on the signed-in
 * user. Counted per route per tracker (see ApiThrottlerGuard) — except /v1, where
 * every read route shares one bucket per key owner and every write route another —
 * and each one sits at or above its nginx counterpart so nginx answers first.
 */
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Every route: about one request a second, sustained, per user or IP. */
export const DEFAULT_LIMIT = { ttl: MINUTE, limit: 300 };
/** Credential and token endpoints: brute-force and mail-bomb guard (nginx `auth` is 10 r/m + 5 burst). */
export const AUTH_LIMIT = { ttl: MINUTE, limit: 20 };
/** Directory list/search reads: the trigram ILIKE queries, the expensive ones. */
export const SEARCH_LIMIT = { ttl: MINUTE, limit: 60 };

export const THROTTLE_MESSAGE = 'Too many requests. Please wait a minute and try again.';
export const DAILY_QUOTA_MESSAGE =
  'Daily API quota reached. It frees up gradually over the next 24 hours.';

/** Login, register, and the password-reset / email-verification token routes. */
export const AuthThrottle = () => Throttle({ default: AUTH_LIMIT });
/** The paginated directory endpoints (`GET /companies`, `/investors`, `/people`, `/funds`)
 *  and the header typeahead (`GET /search`). */
export const SearchThrottle = () => Throttle({ default: SEARCH_LIMIT });

/** Where ApiThrottlerGuard leaves a resolved API key's scope on the request, for the
 *  per-scope limits below. Set before the limits are read (in `shouldSkip`). */
export const KEY_SCOPE = Symbol('apiKeyScope');

const scopeOf = (ctx: ExecutionContext): ApiKeyScope | undefined =>
  ctx.switchToHttp().getRequest<{ [KEY_SCOPE]?: ApiKeyScope }>()[KEY_SCOPE];

/** A dead key never resolves a scope; it is counted on the IP at the contributor rate. */
const keyScope = (ctx: ExecutionContext): ApiKeyScope => scopeOf(ctx) ?? 'contributor';

/** Whether the request was made with a live key. Keys are refused off /v1, so this is also
 *  "a /v1 request". */
const hasKeyScope = (ctx: ExecutionContext): boolean => scopeOf(ctx) !== undefined;

/**
 * One bucket per tracker for a whole family of routes, instead of the library default (one per
 * handler, which made "120 reads a minute" 120 on each of the eleven read routes).
 */
const sharedKey =
  (family: string) =>
  (_ctx: ExecutionContext, tracker: string, name: string): string =>
    createHash('sha256').update(`${family}-${name}-${tracker}`).digest('hex');

/**
 * /v1 reads: one bucket per key owner across every read route and every key they hold, sized
 * by the scope of the key making the request (API_KEY_LIMITS). An owner holding both an admin
 * and a contributor key shares one count, each request checked against its own key's limit.
 */
export const V1ReadThrottle = () =>
  Throttle({
    default: {
      ttl: MINUTE,
      limit: (ctx) => API_KEY_LIMITS[keyScope(ctx)].read,
      generateKey: sharedKey('v1-read'),
    },
  });
/** /v1 writes and moderation: the same, in a bucket of their own. */
export const V1WriteThrottle = () =>
  Throttle({
    default: {
      ttl: MINUTE,
      limit: (ctx) => API_KEY_LIMITS[keyScope(ctx)].write,
      generateKey: sharedKey('v1-write'),
    },
  });

/**
 * The per-account daily quota, registered in ThrottlerModule.forRoot next to `default`. It counts
 * only requests made with a live key (KEY_SCOPE is set by ApiThrottlerGuard.shouldSkip before
 * any limit is read), so no other route and no IP ever holds a daily window.
 *
 * A sliding 24 h window: each hit expires a day after it was made, so a spent quota frees up
 * gradually. `blockDuration: 0` is what makes it slide — the library's default (block for one
 * `ttl` from the moment the limit is passed) would lock the account out for a full day.
 * Throttlers run shortest `ttl` first and stop at the first block, so a per-minute 429 never
 * counts here. The storage keeps one timestamp per hit (≤ the limit per owner) and spreads
 * them into `Math.min`, which is fine at 50k and would overflow the stack past ~120k.
 */
export const V1_DAILY_THROTTLER = {
  name: 'daily',
  ttl: DAY,
  blockDuration: 0,
  limit: (ctx: ExecutionContext) => API_KEY_DAILY_LIMITS[keyScope(ctx)],
  skipIf: (ctx: ExecutionContext) => !hasKeyScope(ctx),
  generateKey: sharedKey('v1-daily'),
} satisfies ThrottlerOptions;

/**
 * Which hops may set X-Forwarded-For (Express `trust proxy`). The default trusts
 * private and loopback addresses: the web container, which forwards the visitor's
 * IP, is always on the compose network, while a caller from the internet never
 * is — so it can't spoof its way into someone else's bucket. Never `true` or a
 * hop count: both trust whatever hop is nearest, including a direct caller.
 */
export const DEFAULT_TRUST_PROXY = 'loopback, linklocal, uniquelocal';

const TRUST_TOKEN = /^(loopback|linklocal|uniquelocal|[0-9a-f:.]+(\/\d{1,3})?)$/i;

/** TRUST_PROXY as Express wants it: a comma list of the subnet names above,
 *  addresses and CIDRs. Null for anything else (`true`, a hop count, a typo). */
export function parseTrustProxy(raw: string | undefined): string | null {
  const value = raw?.trim() || DEFAULT_TRUST_PROXY;
  const tokens = value.split(',').map((t) => t.trim());
  const valid = tokens.every((t) => TRUST_TOKEN.test(t) && !/^\d+$/.test(t));
  return valid ? tokens.join(', ') : null;
}
