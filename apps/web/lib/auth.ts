import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AuthUser, MyContributionsResponse } from '@repo/api';

import { apiFetch } from './api';

export const TOKEN_COOKIE = 'capbase_token';

/** Read the admin JWT from the httpOnly cookie (set by the login route handler). */
export async function getToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(TOKEN_COOKIE)?.value;
}

/** Resolve the current user from the token, or null if unauthenticated/invalid. */
export async function getSession(): Promise<AuthUser | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    return await apiFetch<AuthUser>('/auth/me', {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return null;
  }
}

/** Gate admin pages: redirect to login unless the session is an ADMIN. */
export async function requireAdmin(): Promise<AuthUser> {
  const user = await getSession();
  if (!user || user.role !== 'ADMIN') {
    redirect('/admin/login');
  }
  return user;
}

/** Gate user pages: redirect to login (preserving destination) unless signed in. */
export async function requireUser(next?: string): Promise<AuthUser> {
  const user = await getSession();
  if (!user) {
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  }
  return user;
}

/** The signed-in user's contribution history + current access status. */
export async function getMyContributions(): Promise<MyContributionsResponse> {
  const token = await getToken();
  return apiFetch<MyContributionsResponse>('/auth/me/contributions', {
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}
