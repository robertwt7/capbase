import type { SavedCompanyItem, SavedStatus } from '@repo/api';

import { apiFetch } from './api';
import { getToken } from './auth';

/** The signed-in user's saved companies, newest first. */
export async function getSavedCompanies(): Promise<SavedCompanyItem[]> {
  const token = await getToken();
  return apiFetch<SavedCompanyItem[]>('/auth/me/saved-companies', {
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

/** Whether the signed-in user has saved this company. */
export async function getSavedStatus(slug: string): Promise<SavedStatus> {
  const token = await getToken();
  return apiFetch<SavedStatus>(`/auth/me/saved-companies/${slug}`, {
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

/** Idempotently add a company to the watchlist. */
export async function saveCompany(slug: string): Promise<SavedStatus> {
  const token = await getToken();
  return apiFetch<SavedStatus>(`/auth/me/saved-companies/${slug}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

/** Idempotently remove a company from the watchlist. */
export async function unsaveCompany(slug: string): Promise<SavedStatus> {
  const token = await getToken();
  return apiFetch<SavedStatus>(`/auth/me/saved-companies/${slug}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}
