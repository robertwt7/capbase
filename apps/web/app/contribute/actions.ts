'use server';

import { revalidatePath } from 'next/cache';

import { contributionErrorMessage, submitCompany } from '@/lib/contribute';
import { companyFormSchema, toCompanyInput } from '@/lib/validation/company';
import { fieldErrorsFromZod, type ActionResult } from '@/lib/validation/utils';

/**
 * Authoritative server-side validation. The client validates with the same zod
 * schema for instant feedback, but we never trust it — re-parse here before
 * mapping to the API payload.
 */
export async function createCompanyAction(
  values: unknown,
  turnstileToken?: string | null,
): Promise<ActionResult> {
  const parsed = companyFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error),
      formError: 'Please fix the highlighted fields.',
    };
  }

  try {
    await submitCompany(toCompanyInput(parsed.data), turnstileToken);
  } catch (err) {
    return { ok: false, formError: contributionErrorMessage(err) };
  }

  revalidatePath('/');
  return { ok: true };
}
