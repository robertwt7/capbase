'use server';

import { resetPassword } from '@/lib/account';
import { ApiError } from '@/lib/api';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { resetPasswordFormSchema, toResetPasswordInput } from '@/lib/validation/auth';
import { fieldErrorsFromZod, type ActionResult } from '@/lib/validation/utils';

export async function resetPasswordAction(token: string, values: unknown): Promise<ActionResult> {
  const parsed = resetPasswordFormSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  try {
    await resetPassword(toResetPasswordInput(token, parsed.data));
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) {
      return { ok: false, formError: RATE_LIMITED_MESSAGE };
    }
    if (error instanceof ApiError && error.status === 400) {
      return {
        ok: false,
        formError: 'This reset link is invalid or has expired. Request a new one.',
      };
    }
    return { ok: false, formError: 'Could not reset your password. Please try again.' };
  }
  return { ok: true };
}
