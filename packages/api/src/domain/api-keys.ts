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

/** Per-key limits per minute, enforced by the API throttler. */
export const API_KEY_LIMITS = {
  contributor: { read: 120, write: 60 },
  admin: { read: 600, write: 300 },
} as const;

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
