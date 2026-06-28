'use server';

import { revalidatePath } from 'next/cache';

import { submitRound } from '@/lib/contribute';
import { roundFormSchema, toRoundInput } from '@/lib/validation/round';
import { fieldErrorsFromZod, type ActionResult } from '@/lib/validation/utils';

export async function addRoundAction(slug: string, values: unknown): Promise<ActionResult> {
  if (!slug) {
    return { ok: false, formError: 'Missing company reference. Reload and try again.' };
  }

  const parsed = roundFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error),
      formError: 'Please fix the highlighted fields.',
    };
  }

  try {
    await submitRound(slug, toRoundInput(parsed.data));
  } catch {
    return { ok: false, formError: 'Submission failed. Please check your inputs and try again.' };
  }

  revalidatePath(`/companies/${slug}`);
  return { ok: true };
}
