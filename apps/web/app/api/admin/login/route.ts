import { NextResponse } from 'next/server';
import type { AuthResponse } from '@repo/api';

import { API_URL } from '../../../../lib/api';
import { TOKEN_COOKIE } from '../../../../lib/auth';

// Proxies /auth/login on the API, then stores the JWT in an httpOnly cookie so
// admin server components can read it. Only ADMIN accounts are allowed through.
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }

  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
    cache: 'no-store',
  });

  if (!res.ok) {
    return NextResponse.json({ message: 'Invalid email or password' }, { status: 401 });
  }

  const auth = (await res.json()) as AuthResponse;
  if (auth.user.role !== 'ADMIN') {
    return NextResponse.json({ message: 'This account is not an admin' }, { status: 403 });
  }

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
