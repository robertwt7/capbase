'use server';

import { revalidatePath } from 'next/cache';
import type { CreateFundingRoundInput } from '@repo/api';

import { submitRound } from '../../../lib/contribute';

type FieldKey = 'name' | 'date' | 'amountUsd' | 'postMoneyUsd' | 'lead';

export type RoundFormState = {
  errors?: Partial<Record<FieldKey, string>>;
  formError?: string;
  success?: boolean;
};

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

  const errors: Partial<Record<FieldKey, string>> = {};

  if (!name) errors.name = 'Round name is required.';
  if (!date) errors.date = 'Round date is required.';

  const isWholeNonNegative = (n: number) => Number.isInteger(n) && n >= 0;
  if (!isWholeNonNegative(amountUsd)) errors.amountUsd = 'Enter a valid raise amount.';
  if (postRaw && !isWholeNonNegative(Number(postRaw))) {
    errors.postMoneyUsd = 'Enter a whole number.';
  }

  if (!slug || Object.keys(errors).length > 0) {
    return { errors, formError: 'Please fix the highlighted fields.' };
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
    return { formError: 'Submission failed. Please check your inputs and try again.' };
  }

  revalidatePath(`/companies/${slug}`);
  return { success: true };
}
