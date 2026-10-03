import type {
  CreateAcquisitionInput,
  CreateChangeProposalInput,
  CreateCompanyInput,
  CreateDiversityInput,
  CreateExitInput,
  CreateFundingRoundInput,
  CreateInvestorInput,
  CreatePersonInput,
} from '@repo/api';

import { ApiError, apiFetch } from './api';
import { getToken } from './auth';
import { turnstileHeaders } from './turnstile';

type Submitted = { id: string; moderationStatus: string };

/** POST one contribution as the signed-in user, with the Turnstile token when
 *  the form produced one. Every contribution is created PENDING. */
async function contribute<T extends Submitted>(
  path: string,
  input: unknown,
  turnstileToken?: string | null,
): Promise<T> {
  const token = await getToken();
  return apiFetch<T>(path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token ?? ''}`,
      ...turnstileHeaders(turnstileToken),
    },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Submit a new company. Requires a signed-in session. */
export function submitCompany(
  input: CreateCompanyInput,
  turnstileToken?: string | null,
) {
  return contribute<Submitted & { slug: string }>(
    '/companies',
    input,
    turnstileToken,
  );
}

/** Add a funding round to an existing company. */
export function submitRound(
  slug: string,
  input: CreateFundingRoundInput,
  turnstileToken?: string | null,
) {
  return contribute<Submitted>(
    `/companies/${slug}/rounds`,
    input,
    turnstileToken,
  );
}

/** Add a team member to an existing company. */
export function submitPerson(
  slug: string,
  input: CreatePersonInput,
  turnstileToken?: string | null,
) {
  return contribute<Submitted>(
    `/companies/${slug}/people`,
    input,
    turnstileToken,
  );
}

/** Add an investor to an existing company. */
export function submitInvestor(
  slug: string,
  input: CreateInvestorInput,
  turnstileToken?: string | null,
) {
  return contribute<Submitted>(
    `/companies/${slug}/investors`,
    input,
    turnstileToken,
  );
}

/** Add an acquisition to an existing company. */
export function submitAcquisition(
  slug: string,
  input: CreateAcquisitionInput,
  turnstileToken?: string | null,
) {
  return contribute<Submitted>(
    `/companies/${slug}/acquisitions`,
    input,
    turnstileToken,
  );
}

/** Add an exit event to an existing company. */
export function submitExit(
  slug: string,
  input: CreateExitInput,
  turnstileToken?: string | null,
) {
  return contribute<Submitted>(
    `/companies/${slug}/exits`,
    input,
    turnstileToken,
  );
}

/** Add a diversity signal to an existing company. */
export function submitDiversity(
  slug: string,
  input: CreateDiversityInput,
  turnstileToken?: string | null,
) {
  return contribute<Submitted>(
    `/companies/${slug}/diversity`,
    input,
    turnstileToken,
  );
}

/** Propose a field-level correction to an existing company. */
export function submitProposal(
  slug: string,
  input: CreateChangeProposalInput,
  turnstileToken?: string | null,
) {
  return contribute<Submitted>(
    `/companies/${slug}/proposals`,
    input,
    turnstileToken,
  );
}

/**
 * The form-level message for a failed contribution. The pending cap (429) and
 * the bot check (403) carry a message worth showing as-is; anything else is a
 * generic retry prompt, since the client already validated the fields.
 */
export function contributionErrorMessage(err: unknown): string {
  if (err instanceof ApiError && (err.status === 429 || err.status === 403)) {
    const message = (err.body as { message?: unknown } | undefined)?.message;
    if (typeof message === 'string') return message;
    return err.status === 429
      ? 'You have too many submissions awaiting review. Please try again later.'
      : 'Human verification failed. Please retry.';
  }
  return 'Submission failed. Please check your inputs and try again.';
}
