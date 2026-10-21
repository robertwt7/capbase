import { NextResponse } from 'next/server';
import type { SetupCompleteResponse } from '@repo/api';

import { MFA_COOKIE } from '../../../../../../../lib/auth';
import {
  badRequest,
  EXPIRED_MESSAGE,
  failure,
  finishLogin,
  postToApi,
  readBody,
  readChallenge,
} from '../../../../../../../lib/auth-proxy';

// Forced setup: confirm the authenticator app. Signs the user in and returns the recovery
// codes in the body, to be shown once — they are never stored here.
export async function POST(req: Request) {
  const body = await readBody(req);
  if (!body) return badRequest();
  const challenge = await readChallenge(MFA_COOKIE);
  if (!challenge) {
    return NextResponse.json({ message: EXPIRED_MESSAGE, expired: true }, { status: 401 });
  }
  const { res, data } = await postToApi('/auth/login/setup/totp/confirm', {
    challenge,
    totpChallenge: body.totpChallenge,
    code: body.code,
  });
  if (!res.ok) return failure(res, data, "That code didn't work.", MFA_COOKIE);
  const done = data as unknown as SetupCompleteResponse;
  return finishLogin(done, { extra: { recoveryCodes: done.recoveryCodes } });
}
