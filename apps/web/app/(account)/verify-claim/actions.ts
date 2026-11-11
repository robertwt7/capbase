'use server';

import { revalidatePath } from 'next/cache';

import { ApiError } from '@/lib/api';
import { verifyClaim } from '@/lib/claims';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import type { ActionResultWith } from '@/lib/validation/utils';

export async function verifyClaimAction(
  token: string,
): Promise<ActionResultWith<{ companySlug: string; companyName: string }>> {
  let result: { companySlug: string; companyName: string };
  try {
    result = await verifyClaim(token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) {
      return { ok: false, formError: RATE_LIMITED_MESSAGE };
    }
    if (error instanceof ApiError && error.status === 400) {
      return {
        ok: false,
        formError:
          'This link is invalid, expired, or already used. Open the company profile and start the claim again.',
      };
    }
    return { ok: false, formError: 'Could not confirm the claim. Please try again.' };
  }
  revalidatePath(`/companies/${result.companySlug}`);
  revalidatePath('/profile');
  return { ok: true, ...result };
}
