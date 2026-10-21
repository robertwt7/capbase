import { NextResponse } from 'next/server';
import type { AuthResponse } from '@repo/api';

import { PASSKEY_COOKIE } from '../../../../../lib/auth';
import {
  badRequest,
  EXPIRED_MESSAGE,
  failure,
  finishLogin,
  postToApi,
  readBody,
  readChallenge,
} from '../../../../../lib/auth-proxy';

// Passwordless sign-in, step two: the browser's assertion. A verified passkey (with user
// verification) is a session on its own.
export async function POST(req: Request) {
  const body = await readBody(req);
  if (!body) return badRequest();
  const challenge = await readChallenge(PASSKEY_COOKIE);
  if (!challenge) {
    return NextResponse.json({ message: EXPIRED_MESSAGE, expired: true }, { status: 401 });
  }
  const { res, data } = await postToApi('/auth/passkey/login', { challenge, response: body.response });
  if (!res.ok) {
    const response = failure(res, data, "That passkey couldn't be verified.");
    response.cookies.delete(PASSKEY_COOKIE);
    return response;
  }
  return finishLogin(data as unknown as AuthResponse, { admin: body.admin === true });
}
