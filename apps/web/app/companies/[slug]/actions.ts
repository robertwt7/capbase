'use server';

import { revalidatePath } from 'next/cache';

import { claimErrorMessage, confirmClaim } from '@/lib/claims';
import { type ActionResult } from '@/lib/validation/utils';
import { saveCompany, unsaveCompany } from '@/lib/watchlist';

/** Toggle a company on/off the signed-in user's watchlist. */
export async function setSavedAction(slug: string, saved: boolean): Promise<ActionResult> {
  try {
    if (saved) await saveCompany(slug);
    else await unsaveCompany(slug);
  } catch {
    return { ok: false, formError: 'Could not update your saved list. Are you signed in?' };
  }

  revalidatePath(`/companies/${slug}`);
  revalidatePath('/profile');
  return { ok: true };
}

/** "These facts are still current", from the company's verified representative. Records a
 *  date on their claim only — no value changes, no revision. */
export async function confirmCurrentAction(slug: string): Promise<ActionResult> {
  try {
    await confirmClaim(slug);
  } catch (err) {
    return { ok: false, formError: claimErrorMessage(err) };
  }
  revalidatePath(`/companies/${slug}`);
  revalidatePath('/profile');
  return { ok: true };
}
