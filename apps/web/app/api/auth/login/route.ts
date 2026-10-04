import { NextResponse } from 'next/server';
import type { AuthResponse } from '@repo/api';

import { API_URL } from '../../../../lib/api';
import { TOKEN_COOKIE } from '../../../../lib/auth';
import { forwardedForHeaders } from '../../../../lib/client-ip';
import { RATE_LIMITED_MESSAGE } from '../../../../lib/rate-limit';

// Proxies /auth/login on the API and stores the JWT in an httpOnly cookie so
// server components can read the session. Unlike the admin route, any role is
// allowed through — this is the public sign-in.
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }

  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await forwardedForHeaders()) },
    body: JSON.stringify({ email: body.email, password: body.password }),
    cache: 'no-store',
  });

  if (res.status === 403) {
    return NextResponse.json({ message: 'This account has been suspended.' }, { status: 403 });
  }
  if (res.status === 429) {
    return NextResponse.json({ message: RATE_LIMITED_MESSAGE }, { status: 429 });
  }
  if (!res.ok) {
    return NextResponse.json({ message: 'Invalid email or password' }, { status: 401 });
  }

  const auth = (await res.json()) as AuthResponse;
  const response = NextResponse.json({ user: auth.user });
  response.cookies.set(TOKEN_COOKIE, auth.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
