import { NextResponse } from 'next/server';

import { MFA_COOKIE } from '../../../../../../lib/auth';
import { EXPIRED_MESSAGE, failure, postToApi, readChallenge } from '../../../../../../lib/auth-proxy';

// Forced setup with a passkey: registration options for the user in the MFA cookie.
export async function POST() {
  const challenge = await readChallenge(MFA_COOKIE);
  if (!challenge) {
    return NextResponse.json({ message: EXPIRED_MESSAGE, expired: true }, { status: 401 });
  }
  const { res, data } = await postToApi('/auth/login/setup/passkey-options', { challenge });
  if (!res.ok) return failure(res, data, "Couldn't start setup.", MFA_COOKIE);
  return NextResponse.json({ registerChallenge: data.registerChallenge, options: data.options });
}
