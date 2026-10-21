import { NextResponse } from 'next/server';

import { MFA_COOKIE } from '../../../../../../lib/auth';
import { EXPIRED_MESSAGE, failure, postToApi, readChallenge } from '../../../../../../lib/auth-proxy';

// Assertion options for the second step, bound to the challenge in the MFA cookie.
export async function POST() {
  const challenge = await readChallenge(MFA_COOKIE);
  if (!challenge) {
    return NextResponse.json({ message: EXPIRED_MESSAGE, expired: true }, { status: 401 });
  }
  const { res, data } = await postToApi('/auth/login/mfa/passkey-options', { challenge });
  if (!res.ok) return failure(res, data, "Couldn't start the passkey sign-in.", MFA_COOKIE);
  return NextResponse.json({ options: data.options });
}
