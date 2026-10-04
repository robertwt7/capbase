import type {
  AuthResponse,
  AuthUser,
  ChangePasswordInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  UpdateProfileInput,
  VerifyEmailInput,
} from '@repo/api';

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

/**
 * Change the signed-in user's password (verifies the current one server-side).
 * The API revokes every session on success, so it answers with a fresh token
 * for this one — the caller must store it.
 */
export async function changePassword(input: ChangePasswordInput) {
  const token = await getToken();
  return apiFetch<AuthResponse>('/auth/me/password', {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Ask for a reset link. The API answers the same whether or not the email exists. */
export async function requestPasswordReset(input: ForgotPasswordInput) {
  return apiFetch<{ ok: true }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Spend a reset link. 400 when the token is invalid, used, or expired. */
export async function resetPassword(input: ResetPasswordInput) {
  return apiFetch<{ ok: true }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Spend an email-verification link. Unauthenticated: the token is the credential,
 *  and the link may be opened in a browser that isn't signed in. 400 when it is
 *  invalid, used, expired, or was sent to an address the account no longer has. */
export async function verifyEmail(input: VerifyEmailInput) {
  return apiFetch<{ ok: true }>('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Mail the signed-in user a fresh verification link. 429 within a minute of the last one. */
export async function resendVerification() {
  const token = await getToken();
  return apiFetch<{ ok: true }>('/auth/resend-verification', {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}
