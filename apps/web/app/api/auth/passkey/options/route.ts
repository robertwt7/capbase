import { NextResponse } from 'next/server';

import { PASSKEY_COOKIE } from '../../../../../lib/auth';
import { failure, postToApi, withChallenge } from '../../../../../lib/auth-proxy';

// Passwordless sign-in, step one: options for any of this site's passkeys. The challenge goes
// into its own cookie (see PASSKEY_COOKIE); the options go to the browser.
export async function POST() {
  const { res, data } = await postToApi('/auth/passkey/options');
  if (!res.ok) return failure(res, data, "Couldn't start the passkey sign-in.");
  return withChallenge(NextResponse.json({ options: data.options }), PASSKEY_COOKIE, data.challenge);
}
