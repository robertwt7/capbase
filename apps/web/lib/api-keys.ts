import type { ApiKeySummary, CreateApiKeyInput, CreatedApiKey } from '@repo/api';

import { apiFetch } from './api';
import { getToken } from './auth';

// The signed-in user's own API keys (/profile/api-keys). Never cached: the list changes on
// every create and revoke, and the create response is the only time a secret exists.

async function authHeader() {
  return { authorization: `Bearer ${(await getToken()) ?? ''}` };
}

export async function listApiKeys(): Promise<ApiKeySummary[]> {
  return apiFetch<ApiKeySummary[]>('/auth/me/api-keys', {
    headers: await authHeader(),
    cache: 'no-store',
  });
}

export async function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
  return apiFetch<CreatedApiKey>('/auth/me/api-keys', {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

export async function revokeApiKey(id: string): Promise<void> {
  await apiFetch<void>(`/auth/me/api-keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await authHeader(),
    cache: 'no-store',
  });
}
