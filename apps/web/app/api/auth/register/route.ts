import { NextResponse } from 'next/server';
import type { AuthResponse } from '@repo/api';

import { API_URL } from '../../../../lib/api';
import { TOKEN_COOKIE } from '../../../../lib/auth';

// Proxies /auth/register on the API, then signs the new user straight in by
// storing the returned JWT in the httpOnly cookie.
export async function POST(req: Request) {
  let body: { email?: string; name?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }

  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: body.email, name: body.name, password: body.password }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const message = Array.isArray(data.message)
      ? data.message[0]
      : (data.message ?? 'Registration failed');
    return NextResponse.json({ message }, { status: res.status });
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
