import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { AuthResponse } from '@repo/api';

import { API_URL } from './api';
import { MFA_COOKIE, MFA_COOKIE_OPTIONS, PASSKEY_COOKIE, TOKEN_COOKIE, TOKEN_COOKIE_OPTIONS } from './auth';
import { forwardedForHeaders } from './client-ip';
import { RATE_LIMITED_MESSAGE } from './rate-limit';

// Shared plumbing for the sign-in route handlers under app/api/auth and app/api/admin: they
// proxy one API call each, keep the step's challenge in an httpOnly cookie, and set the session
// cookie when a step finishes. Under /api/(auth|admin)/, so nginx's `auth` zone limits them.

/** A request body as an object, or null when it isn't JSON. */
export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const badRequest = () =>
  NextResponse.json({ message: 'Invalid request body' }, { status: 400 });

/** POST JSON to the API with the visitor's IP; never cached. */
export async function postToApi(
  path: string,
  body?: unknown,
): Promise<{ res: Response; data: Record<string, unknown> }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await forwardedForHeaders()) },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, data };
}

/** The in-progress challenge from a step cookie. */
export async function readChallenge(name: typeof MFA_COOKIE | typeof PASSKEY_COOKIE) {
  return (await cookies()).get(name)?.value;
}

/** The API's 401 for a challenge that is spent, expired or over its attempts. */
const isExpired = (message: unknown) => typeof message === 'string' && /expired/i.test(message);

export const EXPIRED_MESSAGE = 'This sign-in has expired. Start again.';

/**
 * Turn an API failure into the response the sign-in UI reads: `{ message, expired? }`. A dead
 * challenge also clears its cookie, so the form starts over cleanly.
 */
export function failure(
  res: Response,
  data: Record<string, unknown>,
  fallback: string,
  cookie?: typeof MFA_COOKIE | typeof PASSKEY_COOKIE,
): NextResponse {
  const message = typeof data.message === 'string' ? data.message : undefined;
  let response: NextResponse;
  if (res.status === 429) {
    // The 2FA lockout explains itself; the throttler's (or nginx's HTML) one doesn't.
    response = NextResponse.json(
      { message: message && /two-factor/i.test(message) ? message : RATE_LIMITED_MESSAGE },
      { status: 429 },
    );
  } else if (res.status === 403) {
    response = NextResponse.json({ message: 'This account has been suspended.' }, { status: 403 });
  } else if (res.status === 401 && isExpired(message)) {
    response = NextResponse.json({ message: EXPIRED_MESSAGE, expired: true }, { status: 401 });
  } else if ((res.status === 400 || res.status === 401 || res.status === 409) && message) {
    response = NextResponse.json({ message }, { status: res.status });
  } else {
    response = NextResponse.json({ message: fallback }, { status: res.status >= 500 ? 502 : 400 });
  }
  if (cookie && res.status === 401 && isExpired(message)) response.cookies.delete(cookie);
  return response;
}

/** Store a step's challenge for the next request. */
export function withChallenge(
  response: NextResponse,
  name: typeof MFA_COOKIE | typeof PASSKEY_COOKIE,
  challenge: unknown,
): NextResponse {
  if (typeof challenge === 'string') response.cookies.set(name, challenge, MFA_COOKIE_OPTIONS);
  return response;
}

/**
 * The end of every sign-in path: set the session cookie and drop the step cookies. With
 * `admin`, a non-admin who completed every step still gets no session (the /admin/login rule —
 * the flag only ever adds a restriction, so trusting it from the client is safe).
 */
export function finishLogin(
  auth: AuthResponse,
  { admin = false, extra = {} }: { admin?: boolean; extra?: Record<string, unknown> } = {},
): NextResponse {
  if (admin && auth.user.role !== 'ADMIN') {
    const denied = NextResponse.json({ message: 'This account is not an admin' }, { status: 403 });
    denied.cookies.delete(MFA_COOKIE);
    return denied;
  }
  const response = NextResponse.json({ status: 'ok', user: auth.user, ...extra });
  response.cookies.set(TOKEN_COOKIE, auth.accessToken, TOKEN_COOKIE_OPTIONS);
  response.cookies.delete(MFA_COOKIE);
  response.cookies.delete(PASSKEY_COOKIE);
  return response;
}
