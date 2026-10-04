import { Throttle } from '@nestjs/throttler';

/**
 * App-level rate limits. nginx is the front line (per-IP zones in
 * infra/nginx/conf.d/capbase.conf); these are the backstop for a caller that
 * reaches the API without it, and the only limits that can key on the signed-in
 * user. Fixed windows, counted per route per tracker (see ApiThrottlerGuard), and
 * each one sits at or above its nginx counterpart so nginx answers first.
 */
const MINUTE = 60_000;

/** Every route: about one request a second, sustained, per user or IP. */
export const DEFAULT_LIMIT = { ttl: MINUTE, limit: 300 };
/** Credential and token endpoints: brute-force and mail-bomb guard (nginx `auth` is 10 r/m + 5 burst). */
export const AUTH_LIMIT = { ttl: MINUTE, limit: 20 };
/** Directory list/search reads: the trigram ILIKE queries, the expensive ones. */
export const SEARCH_LIMIT = { ttl: MINUTE, limit: 60 };

export const THROTTLE_MESSAGE = 'Too many requests. Please wait a minute and try again.';

/** Login, register, and the password-reset / email-verification token routes. */
export const AuthThrottle = () => Throttle({ default: AUTH_LIMIT });
/** The paginated directory endpoints (`GET /companies`, `/investors`, `/people`, `/funds`). */
export const SearchThrottle = () => Throttle({ default: SEARCH_LIMIT });

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
