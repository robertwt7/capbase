import type { CursorPage, SavedSearchItem, SaveSearchInput } from '@repo/api';
import { apiFetch } from './api';
import { getToken } from './auth';
export async function featureFetch<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const token = await getToken();
  return apiFetch<T>(path, {
    method,
    cache: 'no-store',
    headers: { authorization: `Bearer ${token ?? ''}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export const getSavedSearches = (cursor?: string) =>
  featureFetch<CursorPage<SavedSearchItem>>(
    `/auth/me/saved-searches${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
/** A successful feature read is the UI's access authority. Signed out, make no request. */
export async function savedSearchesIfAvailable(cursor?: string) {
  if (!(await getToken())) return null;
  return getSavedSearches(cursor).catch(() => null);
}
/** The directory only needs to know whether the feature answers: one row, not a page. */
export async function canSaveSearches(): Promise<boolean> {
  if (!(await getToken())) return false;
  return featureFetch('/auth/me/saved-searches?limit=1').then(
    () => true,
    () => false,
  );
}
export const saveSearch = (input: SaveSearchInput) =>
  featureFetch<SavedSearchItem>('/auth/me/saved-searches', 'POST', input);
