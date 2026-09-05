import type {
  IdentifiableType,
  MergeQueueResponse,
  MergeStatus,
  PendingSubmissionsResponse,
  ReviewableType,
  ReviewStatus,
} from '@repo/api';

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

/** The merge queue for a given status (admin-only, always fresh). */
export async function getMergeQueue(
  status: MergeStatus = 'PENDING',
  type?: IdentifiableType,
): Promise<MergeQueueResponse> {
  const token = await getToken();
  const query = `?status=${status}${type ? `&type=${type}` : ''}`;
  return apiFetch<MergeQueueResponse>(`/admin/merges${query}`, {
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

/** Fold one row of a candidate pair into the other. */
export async function mergeCandidate(candidateId: string, survivorId: string): Promise<void> {
  const token = await getToken();
  await apiFetch(`/admin/merges/${candidateId}/merge`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify({ survivorId }),
    cache: 'no-store',
  });
}

/** Mark a pair "not a duplicate" — kept as REJECTED so it is never re-proposed. */
export async function rejectCandidate(candidateId: string): Promise<void> {
  const token = await getToken();
  await apiFetch(`/admin/merges/${candidateId}/reject`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

/** Reverse a merge, restoring both rows. */
export async function unmergeRecord(recordId: string): Promise<void> {
  const token = await getToken();
  await apiFetch(`/admin/merges/records/${recordId}/unmerge`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}
