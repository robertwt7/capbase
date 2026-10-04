'use server';

import { revalidatePath } from 'next/cache';

import { verifyEmail } from '@/lib/account';
import { ApiError } from '@/lib/api';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import type { ActionResult } from '@/lib/validation/utils';

export async function verifyEmailAction(token: string): Promise<ActionResult> {
  try {
    await verifyEmail({ token });
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) {
      return { ok: false, formError: RATE_LIMITED_MESSAGE };
    }
    if (error instanceof ApiError && error.status === 400) {
      return {
        ok: false,
        formError:
          'This link is invalid, expired, or already used. Sign in and resend it from your profile.',
      };
    }
    return { ok: false, formError: 'Could not confirm your email. Please try again.' };
  }
  // Drop the "unverified" banner from any page a signed-in tab has cached.
  revalidatePath('/', 'layout');
  return { ok: true };
}
