'use server';

import { revalidatePath } from 'next/cache';
import {
  COMPANY_STATUSES,
  STAGES,
  type CompanyStatus,
  type CreateCompanyInput,
  type Stage,
} from '@repo/api';

import { submitCompany } from '../../lib/contribute';

export type CompanyFormState = { error?: string; success?: boolean };

export async function createCompanyAction(
  _prev: CompanyFormState,
  formData: FormData,
): Promise<CompanyFormState> {
  const str = (k: string) => ((formData.get(k) as string | null) ?? '').trim();
  const num = (k: string) => Number(formData.get(k));

  const name = str('name');
  const domain = str('domain');
  const oneLiner = str('oneLiner');
  const description = str('description');
  const hq = str('hq');
  const founded = num('founded');
  const headcount = num('headcount');
  const totalRaisedUsd = num('totalRaisedUsd');
  const industry = str('industry')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const status = str('status') as CompanyStatus;
  const stage = str('stage') as Stage;
  const lastValuationRaw = str('lastValuationUsd');

  if (!name || !domain || !oneLiner || !description || !hq) {
    return { error: 'Please fill in all required fields.' };
  }
  if (industry.length === 0) {
    return { error: 'Add at least one industry tag (comma-separated).' };
  }
  if (!COMPANY_STATUSES.includes(status)) return { error: 'Pick a valid status.' };
  if (!STAGES.includes(stage)) return { error: 'Pick a valid stage.' };
  if ([founded, headcount, totalRaisedUsd].some((n) => !Number.isInteger(n) || n < 0)) {
    return { error: 'Founded, headcount, and total raised must be whole numbers.' };
  }

  const input: CreateCompanyInput = {
    name,
    domain,
    oneLiner,
    description,
    hq,
    founded,
    headcount,
    industry,
    status,
    stage,
    totalRaisedUsd,
    ...(lastValuationRaw ? { lastValuationUsd: Number(lastValuationRaw) } : {}),
  };

  try {
    await submitCompany(input);
  } catch {
    return { error: 'Submission failed. Please check your inputs and try again.' };
  }

  revalidatePath('/');
  return { success: true };
}
