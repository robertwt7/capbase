'use server';

import { revalidatePath } from 'next/cache';
import {
  COMPANY_STATUSES,
  SECTORS,
  STAGES,
  type CompanyStatus,
  type CreateCompanyInput,
  type Sector,
  type Stage,
} from '@repo/api';

import { submitCompany } from '../../lib/contribute';

type FieldKey =
  | 'name'
  | 'domain'
  | 'oneLiner'
  | 'description'
  | 'hq'
  | 'founded'
  | 'headcount'
  | 'totalRaisedUsd'
  | 'industry'
  | 'primarySector'
  | 'status'
  | 'stage'
  | 'lastValuationUsd';

export type CompanyFormState = {
  errors?: Partial<Record<FieldKey, string>>;
  formError?: string;
  success?: boolean;
};

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
  const primarySector = str('primarySector') as Sector;
  const status = str('status') as CompanyStatus;
  const stage = str('stage') as Stage;
  const lastValuationRaw = str('lastValuationUsd');

  const errors: Partial<Record<FieldKey, string>> = {};

  if (!name) errors.name = 'Company name is required.';
  if (!domain) errors.domain = 'Website domain is required.';
  if (!oneLiner) errors.oneLiner = 'A one-liner is required.';
  if (!description) errors.description = 'A description is required.';
  if (!hq) errors.hq = 'Headquarters is required.';

  const isWholeNonNegative = (n: number) => Number.isInteger(n) && n >= 0;
  if (!isWholeNonNegative(founded)) errors.founded = 'Enter a valid year.';
  if (!isWholeNonNegative(headcount)) errors.headcount = 'Enter a whole number.';
  if (!isWholeNonNegative(totalRaisedUsd)) errors.totalRaisedUsd = 'Enter a whole number.';

  if (industry.length === 0) {
    errors.industry = 'Add at least one industry tag (comma-separated).';
  }
  if (!SECTORS.includes(primarySector)) errors.primarySector = 'Pick a valid sector.';
  if (!COMPANY_STATUSES.includes(status)) errors.status = 'Pick a valid status.';
  if (!STAGES.includes(stage)) errors.stage = 'Pick a valid stage.';

  if (lastValuationRaw) {
    const lastValuation = Number(lastValuationRaw);
    if (!isWholeNonNegative(lastValuation)) {
      errors.lastValuationUsd = 'Enter a whole number.';
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors, formError: 'Please fix the highlighted fields.' };
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
    primarySector,
    status,
    stage,
    totalRaisedUsd,
    ...(lastValuationRaw ? { lastValuationUsd: Number(lastValuationRaw) } : {}),
  };

  try {
    await submitCompany(input);
  } catch {
    return { formError: 'Submission failed. Please check your inputs and try again.' };
  }

  revalidatePath('/');
  return { success: true };
}
