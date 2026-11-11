import {
  CLAIM_DOMAIN_MISMATCH,
  CLAIM_EMAIL_UNAVAILABLE,
  EMAIL_UNVERIFIED,
  type ClaimRequestInput,
  type CompanyClaimView,
  type ConfirmClaimResponse,
  type MyCompanyClaim,
  type StartEmailClaimInput,
  type VerifyClaimResponse,
} from '@repo/api';

import { ApiError, apiFetch } from './api';
import { getToken } from './auth';
import { RATE_LIMITED_MESSAGE } from './rate-limit';
import { turnstileHeaders } from './turnstile';

/**
 * Company claims ("this is my company"). Every call is `no-store` and there is no mock
 * fallback: a claim is the caller's own state, never a cached public read.
 */
async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  return apiFetch<T>(path, {
    ...init,
    headers: { authorization: `Bearer ${token ?? ''}`, ...(init.headers ?? {}) },
    cache: 'no-store',
  });
}

/** The claim page's view: the caller's claims on this company and which flow is offered.
 *  Null when the company doesn't exist (or isn't public). */
export async function getCompanyClaim(slug: string): Promise<CompanyClaimView | null> {
  try {
    return await authed<CompanyClaimView>(`/companies/${encodeURIComponent(slug)}/claim`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function startEmailClaim(
  slug: string,
  input: StartEmailClaimInput,
  turnstileToken?: string | null,
): Promise<{ ok: true }> {
  return authed(`/companies/${encodeURIComponent(slug)}/claim/email`, {
    method: 'POST',
    headers: turnstileHeaders(turnstileToken),
    body: JSON.stringify(input),
  });
}

export function sendClaimRequest(
  slug: string,
  input: ClaimRequestInput,
  turnstileToken?: string | null,
): Promise<MyCompanyClaim> {
  return authed(`/companies/${encodeURIComponent(slug)}/claim/request`, {
    method: 'POST',
    headers: turnstileHeaders(turnstileToken),
    body: JSON.stringify(input),
  });
}

/** Spend a claim link. Public: the token is the credential. */
export function verifyClaim(token: string): Promise<VerifyClaimResponse> {
  return apiFetch<VerifyClaimResponse>('/claims/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
    cache: 'no-store',
  });
}

/** "These facts are still current" on a company the caller represents. */
export function confirmClaim(slug: string): Promise<ConfirmClaimResponse> {
  return authed(`/companies/${encodeURIComponent(slug)}/claim/confirm`, { method: 'POST' });
}

/** Every claim the signed-in user holds, newest first. */
export function getMyClaims(): Promise<MyCompanyClaim[]> {
  return authed<MyCompanyClaim[]>('/auth/me/claims');
}

export function withdrawClaim(id: string): Promise<MyCompanyClaim> {
  return authed<MyCompanyClaim>(`/auth/me/claims/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** The form-level message for a failed claim call. */
export function claimErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  const body = err.body as { code?: unknown; message?: unknown } | undefined;
  const message = typeof body?.message === 'string' ? body.message : undefined;
  if (body?.code === EMAIL_UNVERIFIED) {
    return 'Confirm your account email first — use the link we emailed you, or resend it from the banner above.';
  }
  if (body?.code === CLAIM_DOMAIN_MISMATCH) {
    return "That address isn't at this company's domain. Use your work address, or send a request for review below.";
  }
  if (body?.code === CLAIM_EMAIL_UNAVAILABLE) {
    return "This company can't be claimed by email. Send a request for review instead.";
  }
  if (err.status === 409) return message ?? 'You already have a claim on this company.';
  if (err.status === 429) return message ?? RATE_LIMITED_MESSAGE;
  if (err.status === 403) return message ?? 'Human verification failed. Please retry.';
  if (err.status === 404) return 'This company could not be found.';
  return 'Something went wrong. Please try again.';
}
