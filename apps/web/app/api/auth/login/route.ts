import { NextResponse } from 'next/server';
import type { AuthResponse, LoginResponse } from '@repo/api';

import { MFA_COOKIE } from '../../../../lib/auth';
import { badRequest, finishLogin, postToApi, readBody, withChallenge } from '../../../../lib/auth-proxy';
import { RATE_LIMITED_MESSAGE } from '../../../../lib/rate-limit';

// Proxies /auth/login on the API. A sign-in without a second factor sets the httpOnly session
// cookie here; otherwise the step's challenge goes into the httpOnly MFA cookie and the client
// is told which step comes next (`mfa` or `mfa_setup`) — never the token. Unlike the admin
// route, any role is allowed through: this is the public sign-in.
export async function POST(req: Request) {
  const body = await readBody(req);
  if (!body) return badRequest();

  const { res, data } = await postToApi('/auth/login', { email: body.email, password: body.password });

  if (res.status === 403) {
    return NextResponse.json({ message: 'This account has been suspended.' }, { status: 403 });
  }
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
  return finishLogin(login as AuthResponse);
}
