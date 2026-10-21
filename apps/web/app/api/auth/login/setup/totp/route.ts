import { NextResponse } from 'next/server';

import { MFA_COOKIE } from '../../../../../../lib/auth';
import { EXPIRED_MESSAGE, failure, postToApi, readChallenge } from '../../../../../../lib/auth-proxy';

// Forced setup: start an authenticator-app enrollment. The enrollment challenge goes back to
// the page — it is useless without the setup challenge, which stays in the httpOnly cookie.
export async function POST() {
  const challenge = await readChallenge(MFA_COOKIE);
  if (!challenge) {
    return NextResponse.json({ message: EXPIRED_MESSAGE, expired: true }, { status: 401 });
  }
  const { res, data } = await postToApi('/auth/login/setup/totp', { challenge });
  if (!res.ok) return failure(res, data, "Couldn't start setup.", MFA_COOKIE);
  return NextResponse.json({
    secret: data.secret,
    otpauthUri: data.otpauthUri,
    totpChallenge: data.challenge,
  });
}
