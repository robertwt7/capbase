'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';

import {
  contributionErrorMessage,
  submitAcquisition,
  submitDiversity,
  submitExit,
  submitInvestor,
  submitPerson,
  submitProposal,
  submitRound,
} from '@/lib/contribute';
import { getCompanyDetail } from '@/lib/data';
import { editFormSchema, toProposalInput } from '@/lib/validation/proposal';
import { acquisitionFormSchema, toAcquisitionInput } from '@/lib/validation/acquisition';
import { diversityFormSchema, toDiversityInput } from '@/lib/validation/diversity';
import { exitFormSchema, toExitInput } from '@/lib/validation/exit';
import { investorFormSchema, toInvestorInput } from '@/lib/validation/investor';
import { personFormSchema, toPersonInput } from '@/lib/validation/person';
import { roundFormSchema, toRoundInput } from '@/lib/validation/round';
import { fieldErrorsFromZod, type ActionResult } from '@/lib/validation/utils';

/** Shared tail of every contribution action: report parse failures in the shape
    the client form understands, submit, and revalidate the profile page. */
async function handleContribution<T>(
  slug: string,
  parsed: { success: true; data: T } | { success: false; error: z.ZodError },
  submit: (data: T) => Promise<unknown>,
): Promise<ActionResult> {
  if (!slug) {
    return { ok: false, formError: 'Missing company reference. Reload and try again.' };
  }

  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error),
      formError: 'Please fix the highlighted fields.',
    };
  }

  try {
    await submit(parsed.data);
  } catch (err) {
    return { ok: false, formError: contributionErrorMessage(err) };
  }

  revalidatePath(`/companies/${slug}`);
  return { ok: true };
}

export async function addRoundAction(
  slug: string,
  values: unknown,
  turnstileToken?: string | null,
): Promise<ActionResult> {
  return handleContribution(slug, roundFormSchema.safeParse(values), (data) =>
    submitRound(slug, toRoundInput(data), turnstileToken),
  );
}

export async function addInvestorAction(
  slug: string,
  values: unknown,
  turnstileToken?: string | null,
): Promise<ActionResult> {
  return handleContribution(slug, investorFormSchema.safeParse(values), (data) =>
    submitInvestor(slug, toInvestorInput(data), turnstileToken),
  );
}

export async function addPersonAction(
  slug: string,
  values: unknown,
  turnstileToken?: string | null,
): Promise<ActionResult> {
  return handleContribution(slug, personFormSchema.safeParse(values), (data) =>
    submitPerson(slug, toPersonInput(data), turnstileToken),
  );
}

export async function addAcquisitionAction(
  slug: string,
  values: unknown,
  turnstileToken?: string | null,
): Promise<ActionResult> {
  return handleContribution(slug, acquisitionFormSchema.safeParse(values), (data) =>
    submitAcquisition(slug, toAcquisitionInput(data), turnstileToken),
  );
}

export async function addExitAction(
  slug: string,
  values: unknown,
  turnstileToken?: string | null,
): Promise<ActionResult> {
  return handleContribution(slug, exitFormSchema.safeParse(values), (data) =>
    submitExit(slug, toExitInput(data), turnstileToken),
  );
}

export async function addDiversityAction(
  slug: string,
  values: unknown,
  turnstileToken?: string | null,
): Promise<ActionResult> {
  return handleContribution(slug, diversityFormSchema.safeParse(values), (data) =>
    submitDiversity(slug, toDiversityInput(data), turnstileToken),
  );
}

/** Edit proposal: diff the submitted values against the company's *current*
    values (server-authoritative — the client never sends "old" state) and
    submit only the changed fields. */
export async function proposeEditAction(
  slug: string,
  values: unknown,
  turnstileToken?: string | null,
): Promise<ActionResult> {
  if (!slug) {
    return { ok: false, formError: 'Missing company reference. Reload and try again.' };
  }

  const parsed = editFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: fieldErrorsFromZod(parsed.error),
      formError: 'Please fix the highlighted fields.',
    };
  }

  const detail = await getCompanyDetail(slug);
  if (!detail) {
    return { ok: false, formError: 'Company not found. Reload and try again.' };
  }

  const input = toProposalInput(parsed.data, detail.company);
  if (!input) {
    return { ok: false, formError: "You haven't changed anything yet." };
  }

  try {
    await submitProposal(slug, input, turnstileToken);
  } catch (err) {
    return { ok: false, formError: contributionErrorMessage(err) };
  }

  revalidatePath(`/companies/${slug}`);
  return { ok: true };
}
