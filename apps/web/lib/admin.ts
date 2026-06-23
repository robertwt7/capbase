import type { PendingSubmissionsResponse, ReviewableType, ReviewStatus } from '@repo/api';

import { apiFetch } from './api';
import { getToken } from './auth';

/** Fetch the moderation queue for a given status (admin-only, always fresh). */
export async function getSubmissions(
  status: ReviewStatus,
): Promise<PendingSubmissionsResponse> {
  const token = await getToken();
  return apiFetch<PendingSubmissionsResponse>(`/admin/submissions?status=${status}`, {
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

/** Approve/reject a single submission. */
export async function moderateSubmission(
  type: ReviewableType,
  id: string,
  status: 'APPROVED' | 'REJECTED',
): Promise<void> {
  const token = await getToken();
  await apiFetch(`/admin/submissions/${type}/${id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify({ status }),
    cache: 'no-store',
  });
}
