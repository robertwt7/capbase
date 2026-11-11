'use server';

import { revalidatePath } from 'next/cache';

import {
  claimErrorMessage,
  sendClaimRequest,
  startEmailClaim,
  withdrawClaim,
} from '@/lib/claims';
import {
  claimEmailFormSchema,
  claimRequestFormSchema,
  toClaimRequestInput,
  toStartEmailClaimInput,
} from '@/lib/validation/claim';
import { fieldErrorsFromZod, type ActionResult } from '@/lib/validation/utils';

/** Mail a claim link to a work address. The server re-validates; never trust the client. */
export async function startEmailClaimAction(
  slug: string,
  values: unknown,
  turnstileToken?: string | null,
): Promise<ActionResult> {
  const parsed = claimEmailFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error),
      formError: 'Please fix the highlighted fields.',
    };
  }
  try {
    await startEmailClaim(slug, toStartEmailClaimInput(parsed.data), turnstileToken);
  } catch (err) {
    return { ok: false, formError: claimErrorMessage(err) };
  }
  return { ok: true };
}

/** Send a manual request for review. */
export async function sendClaimRequestAction(
  slug: string,
  values: unknown,
  turnstileToken?: string | null,
): Promise<ActionResult> {
  const parsed = claimRequestFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error),
      formError: 'Please fix the highlighted fields.',
    };
  }
  try {
    await sendClaimRequest(slug, toClaimRequestInput(parsed.data), turnstileToken);
  } catch (err) {
    return { ok: false, formError: claimErrorMessage(err) };
  }
  revalidatePath(`/companies/${slug}/claim`);
  revalidatePath('/profile');
  return { ok: true };
}

/** Withdraw one of the caller's claims (a plain `<form action>`; the page re-renders). */
export async function withdrawClaimAction(id: string, slug?: string): Promise<void> {
  try {
    await withdrawClaim(id);
  } catch {
    // The list re-renders from the API either way; a stale id simply stays as it was.
  }
  revalidatePath('/profile');
  if (slug) {
    revalidatePath(`/companies/${slug}/claim`);
    revalidatePath(`/companies/${slug}`);
  }
}
