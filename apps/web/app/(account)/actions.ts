'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { resendVerification } from '../../lib/account';
import { ApiError } from '../../lib/api';
import { TOKEN_COOKIE } from '../../lib/auth';

/** Clear the session cookie and return to the landing page. */
export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
  redirect('/');
}

/** Mail the signed-in user a fresh verification link (the "Resend link" button). */
export async function resendVerificationAction(): Promise<{ ok: boolean; message: string }> {
  try {
    await resendVerification();
  } catch (error) {
    // The 429 carries the API's own "less than a minute ago" wording.
    if (error instanceof ApiError && error.status === 429) {
      const message = (error.body as { message?: unknown } | undefined)?.message;
      return {
        ok: false,
        message: typeof message === 'string' ? message : 'Please wait a minute and try again.',
      };
    }
    return { ok: false, message: 'Could not send a new link. Please try again.' };
  }
  return { ok: true, message: 'Sent — check your inbox.' };
}
