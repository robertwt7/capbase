'use server';

import { requestPasswordReset } from '@/lib/account';
import { forgotPasswordFormSchema, toForgotPasswordInput } from '@/lib/validation/auth';
import { fieldErrorsFromZod, type ActionResult } from '@/lib/validation/utils';

export async function forgotPasswordAction(values: unknown): Promise<ActionResult> {
  const parsed = forgotPasswordFormSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  try {
    await requestPasswordReset(toForgotPasswordInput(parsed.data));
  } catch {
    return { ok: false, formError: 'Could not send the link right now. Please try again.' };
  }
  return { ok: true };
}
