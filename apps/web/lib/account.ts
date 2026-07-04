import type { AuthUser, ChangePasswordInput, UpdateProfileInput } from '@repo/api';

import { apiFetch } from './api';
import { getToken } from './auth';

/** Update the signed-in user's name/email. */
export async function updateProfile(input: UpdateProfileInput) {
  const token = await getToken();
  return apiFetch<AuthUser>('/auth/me', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Change the signed-in user's password (verifies the current one server-side). */
export async function changePassword(input: ChangePasswordInput) {
  const token = await getToken();
  return apiFetch<{ ok: true }>('/auth/me/password', {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}
