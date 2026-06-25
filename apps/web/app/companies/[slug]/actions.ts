'use server';

import { revalidatePath } from 'next/cache';
import type { CreateFundingRoundInput } from '@repo/api';

import { submitRound } from '../../../lib/contribute';

export type RoundFormState = { error?: string; success?: boolean };

export async function addRoundAction(
  _prev: RoundFormState,
  formData: FormData,
): Promise<RoundFormState> {
  const str = (k: string) => ((formData.get(k) as string | null) ?? '').trim();
  const num = (k: string) => Number(formData.get(k));

  const slug = str('slug');
  const name = str('name');
  const date = str('date');
  const amountUsd = num('amountUsd');
  const postRaw = str('postMoneyUsd');
  const lead = str('lead');

  if (!slug || !name || !date) {
    return { error: 'Round name and date are required.' };
  }
  if (!Number.isInteger(amountUsd) || amountUsd < 0) {
    return { error: 'Enter a valid raise amount.' };
  }

  const input: CreateFundingRoundInput = {
    name,
    date,
    amountUsd,
    ...(postRaw ? { postMoneyUsd: Number(postRaw) } : {}),
    ...(lead ? { lead } : {}),
    investors: lead ? [{ name: lead, lead: true }] : [],
  };

  try {
    await submitRound(slug, input);
  } catch {
    return { error: 'Submission failed. Please check your inputs and try again.' };
  }

  revalidatePath(`/companies/${slug}`);
  return { success: true };
}
