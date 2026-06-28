'use server';

import { revalidatePath } from 'next/cache';

import { submitCompany } from '@/lib/contribute';
import { companyFormSchema, toCompanyInput } from '@/lib/validation/company';
import { fieldErrorsFromZod, type ActionResult } from '@/lib/validation/utils';

/**
 * Authoritative server-side validation. The client validates with the same zod
 * schema for instant feedback, but we never trust it — re-parse here before
 * mapping to the API payload.
 */
export async function createCompanyAction(values: unknown): Promise<ActionResult> {
  const parsed = companyFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error),
      formError: 'Please fix the highlighted fields.',
    };
  }

  try {
    await submitCompany(toCompanyInput(parsed.data));
  } catch {
    return { ok: false, formError: 'Submission failed. Please check your inputs and try again.' };
  }

  revalidatePath('/');
  return { ok: true };
}
