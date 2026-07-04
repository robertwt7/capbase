import type {
  CreateAcquisitionInput,
  CreateCompanyInput,
  CreateDiversityInput,
  CreateExitInput,
  CreateFundingRoundInput,
  CreateInvestorInput,
  CreatePersonInput,
} from '@repo/api';

import { apiFetch } from './api';
import { getToken } from './auth';

/** Submit a new company (created as PENDING). Requires a signed-in session. */
export async function submitCompany(input: CreateCompanyInput) {
  const token = await getToken();
  return apiFetch<{ id: string; slug: string; moderationStatus: string }>('/companies', {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Add a funding round to an existing company (created as PENDING). */
export async function submitRound(slug: string, input: CreateFundingRoundInput) {
  const token = await getToken();
  return apiFetch<{ id: string; moderationStatus: string }>(`/companies/${slug}/rounds`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Add a team member to an existing company (created as PENDING). */
export async function submitPerson(slug: string, input: CreatePersonInput) {
  const token = await getToken();
  return apiFetch<{ id: string; moderationStatus: string }>(`/companies/${slug}/people`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Add an investor to an existing company (created as PENDING). */
export async function submitInvestor(slug: string, input: CreateInvestorInput) {
  const token = await getToken();
  return apiFetch<{ id: string; moderationStatus: string }>(`/companies/${slug}/investors`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Add an acquisition to an existing company (created as PENDING). */
export async function submitAcquisition(slug: string, input: CreateAcquisitionInput) {
  const token = await getToken();
  return apiFetch<{ id: string; moderationStatus: string }>(`/companies/${slug}/acquisitions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Add an exit event to an existing company (created as PENDING). */
export async function submitExit(slug: string, input: CreateExitInput) {
  const token = await getToken();
  return apiFetch<{ id: string; moderationStatus: string }>(`/companies/${slug}/exits`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Add a diversity signal to an existing company (created as PENDING). */
export async function submitDiversity(slug: string, input: CreateDiversityInput) {
  const token = await getToken();
  return apiFetch<{ id: string; moderationStatus: string }>(`/companies/${slug}/diversity`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}
