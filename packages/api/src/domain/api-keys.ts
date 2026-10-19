// Personal API keys for the public, key-authenticated API at /v1. The API, the web's key pages
// and /developers all read these constants, so a limit is stated in exactly one place.

import type { Role } from './auth';

/** A contributor key's writes land PENDING; an admin key's are published at once and it may
 *  moderate the queue. A scope is a ceiling: the owner's current role must still permit it. */
export type ApiKeyScope = 'contributor' | 'admin';

export const API_KEY_SCOPES: readonly ApiKeyScope[] = ['contributor', 'admin'];

/** Every key starts with this, so a leaked one is greppable (and secret scanners can match it). */
export const API_KEY_PREFIX = 'cbk_';

export const MAX_ACTIVE_API_KEYS = 5;
export const MAX_API_KEY_CIDRS = 10;
export const API_KEY_NAME_MAX = 80;

/** Pending cap for submissions made with a key (the website's stays MAX_PENDING_SUBMISSIONS). */
export const MAX_PENDING_API_SUBMISSIONS = 500;

/** Per-account limits per minute, enforced by the API throttler: every key one account holds,
 *  and every /v1 route, share one read bucket and one write bucket. Sized by the scope of the
 *  key making the request. */
export const API_KEY_LIMITS = {
  contributor: { read: 120, write: 60 },
  admin: { read: 600, write: 300 },
} as const;

/** Per-account requests per day across every key and every /v1 route, reads and writes
 *  together. The per-minute limits shape bursts; this bounds what one account can pull. */
export const API_KEY_DAILY_LIMITS = {
  contributor: 10_000,
  admin: 50_000,
} as const satisfies Record<ApiKeyScope, number>;

/** The deepest row a /v1 list serves: `page × pageSize` may not exceed it. Lookups and filtered
 *  lists are unaffected; paging through a whole directory is not what the API is for. */
export const MAX_V1_LIST_DEPTH = 10_000;

/** The key scopes a role may hold (and mint). USER holds none. */
export function scopesForRole(role: Role): readonly ApiKeyScope[] {
  if (role === 'ADMIN') return API_KEY_SCOPES;
  if (role === 'CONTRIBUTOR') return ['contributor'];
  return [];
}

export interface ApiKeySummary {
  id: string;
  name: string;
  /** `cbk_` + the 8-char public id. Never the secret. */
  prefix: string;
  scope: ApiKeyScope;
  allowedCidrs: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreateApiKeyInput {
  name: string;
  scope: ApiKeyScope;
  allowedCidrs?: string[];
}

/** The only response that ever carries the secret. */
export interface CreatedApiKey {
  key: ApiKeySummary;
  token: string;
}

/** `GET /v1/me`: who the key belongs to and how much of the pending cap is used. */
export interface ApiKeyWhoAmI {
  user: { id: string; name: string; email: string; role: Role };
  key: { prefix: string; scope: ApiKeyScope };
  /** PENDING submissions the owner has in the queue now. */
  pending: number;
  /** Null for an admin, who is exempt. */
  pendingCap: number | null;
}
