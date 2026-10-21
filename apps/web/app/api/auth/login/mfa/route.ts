import { NextResponse } from 'next/server';
import type { AuthResponse } from '@repo/api';

import { MFA_COOKIE } from '../../../../../lib/auth';
import {
  badRequest,
  EXPIRED_MESSAGE,
  failure,
  finishLogin,
  postToApi,
  readBody,
  readChallenge,
} from '../../../../../lib/auth-proxy';

// The second sign-in step: a TOTP code, a recovery code, or a passkey assertion, checked
// against the challenge in the MFA cookie. `admin: true` (from /admin/login) refuses a
// non-admin even after a correct factor.
export async function POST(req: Request) {
  const body = await readBody(req);
  if (!body) return badRequest();
  const challenge = await readChallenge(MFA_COOKIE);
  if (!challenge) {
    return NextResponse.json({ message: EXPIRED_MESSAGE, expired: true }, { status: 401 });
  }

  const { res, data } = await postToApi('/auth/login/mfa', {
    challenge,
    method: body.method,
    code: typeof body.code === 'string' ? body.code : undefined,
    response: body.response,
  });
  if (!res.ok) return failure(res, data, "That code didn't work.", MFA_COOKIE);
  return finishLogin(data as unknown as AuthResponse, { admin: body.admin === true });
}
