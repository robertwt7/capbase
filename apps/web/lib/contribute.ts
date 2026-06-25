import type { CreateCompanyInput, CreateFundingRoundInput } from '@repo/api';

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
