import { NextResponse } from 'next/server';
import type { AuthResponse, LoginResponse } from '@repo/api';

import { MFA_COOKIE } from '../../../../lib/auth';
import { badRequest, finishLogin, postToApi, readBody, withChallenge } from '../../../../lib/auth-proxy';
import { RATE_LIMITED_MESSAGE } from '../../../../lib/rate-limit';

// Proxies /auth/login on the API, then stores the JWT in an httpOnly cookie so admin server
// components can read it. Only ADMIN accounts are allowed through — checked after the API
// answers, here and again on the second-factor step (which the admin page calls with
// `admin: true`), since the role is unknown until the password is proven.
export async function POST(req: Request) {
  const body = await readBody(req);
  if (!body) return badRequest();

  const { res, data } = await postToApi('/auth/login', { email: body.email, password: body.password });

  if (res.status === 429) {
    const message = typeof data.message === 'string' && /two-factor/i.test(data.message);
    return NextResponse.json(
      { message: message ? data.message : RATE_LIMITED_MESSAGE },
      { status: 429 },
    );
  }
  if (!res.ok) {
    return NextResponse.json({ message: 'Invalid email or password' }, { status: 401 });
  }

  const login = data as unknown as LoginResponse;
  if (login.status === 'mfa') {
    return withChallenge(
      NextResponse.json({ status: 'mfa', methods: login.methods }),
      MFA_COOKIE,
      login.challenge,
    );
  }
  if (login.status === 'mfa_setup') {
    return withChallenge(NextResponse.json({ status: 'mfa_setup' }), MFA_COOKIE, login.challenge);
  }
  return finishLogin(login as AuthResponse, { admin: true });
}
