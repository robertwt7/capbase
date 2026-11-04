import type {
  AdminUser,
  AdminVisibilityResponse,
  FieldPolicy,
  SectionPolicy,
  AdminUserDetail,
  IdentifiableType,
  MergeQueueResponse,
  MergeStatus,
  Paginated,
  PendingSubmissionsResponse,
  ReviewableType,
  ReportQueueResponse,
  ReportStatus,
  ResolveReportInput,
  SubmissionQuery,
  UpdateUserInput,
} from '@repo/api';

import { apiFetch } from './api';
import { getToken } from './auth';

/** One page of the moderation queue (admin-only, always fresh): a status plus
 *  optional type, source, contributor and company/firm name. `before` is the
 *  previous page's `nextCursor`. */
export async function getSubmissions(q: SubmissionQuery): Promise<PendingSubmissionsResponse> {
  const token = await getToken();
  const query = new URLSearchParams({ status: q.status });
  if (q.type) query.set('type', q.type);
  if (q.before) query.set('before', q.before);
  if (q.source) query.set('source', q.source);
  if (q.userId) query.set('user', q.userId);
  if (q.q) query.set('q', q.q);
  return apiFetch<PendingSubmissionsResponse>(`/admin/submissions?${query}`, {
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

/** How many submissions are PENDING across every type — the nav badge, without
 *  rendering a page of the queue. */
export async function getSubmissionCount(): Promise<number> {
  const token = await getToken();
  const { total } = await apiFetch<{ total: number }>('/admin/submissions/count', {
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
  return total;
}

/** Approve/reject a single submission. `note` is a rejection reason, emailed to
 *  the contributor (never stored). */
export async function moderateSubmission(
  type: ReviewableType,
  id: string,
  status: 'APPROVED' | 'REJECTED',
  note?: string,
): Promise<void> {
  const token = await getToken();
  await apiFetch(`/admin/submissions/${type}/${id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify({ status, note }),
    cache: 'no-store',
  });
}

/** One page of the merge queue for a status (admin-only, always fresh). */
export async function getMergeQueue(
  status: MergeStatus = 'PENDING',
  type?: IdentifiableType,
  page = 1,
): Promise<MergeQueueResponse> {
  const token = await getToken();
  const query = `?status=${status}${type ? `&type=${type}` : ''}${page > 1 ? `&page=${page}` : ''}`;
  return apiFetch<MergeQueueResponse>(`/admin/merges${query}`, {
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

/** How many candidates are in a status — the nav badge, without rendering any. */
export async function getMergeCount(status: MergeStatus = 'PENDING'): Promise<number> {
  const token = await getToken();
  const { total } = await apiFetch<{ total: number }>(`/admin/merges/count?status=${status}`, {
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
  return total;
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

/** Accounts, newest first, optionally filtered by email/name (admin-only). */
export async function getUsers(q: string | undefined, page: number): Promise<Paginated<AdminUser>> {
  const token = await getToken();
  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set('q', q);
  return apiFetch<Paginated<AdminUser>>(`/admin/users?${params.toString()}`, {
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

/** One account with its contribution counts per status and its gate state now. */
export async function getAdminUser(id: string): Promise<AdminUserDetail> {
  const token = await getToken();
  return apiFetch<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

/** Ban/unban or change the role of one account. */
export async function updateUser(id: string, input: UpdateUserInput): Promise<AdminUser> {
  const token = await getToken();
  return apiFetch<AdminUser>(`/admin/users/${id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

/** Remove every second factor and sign the account out everywhere; the API emails the user. */
export async function resetUserMfa(id: string): Promise<AdminUser> {
  const token = await getToken();
  return apiFetch<AdminUser>(`/admin/users/${id}/reset-mfa`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

// --- Reports ----------------------------------------------------------------

/** The "Report an issue" queue for one status (admin-only, always fresh). */
export async function getReports(status: ReportStatus = 'OPEN'): Promise<ReportQueueResponse> {
  const token = await getToken();
  return apiFetch<ReportQueueResponse>(`/admin/reports?status=${status}`, {
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

/** Close a report without acting on it. */
export async function dismissReport(id: string, note?: string): Promise<void> {
  const token = await getToken();
  await apiFetch(`/admin/reports/${id}/dismiss`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify({ note }),
    cache: 'no-store',
  });
}

/** Close a report with a note and optional link; `suppressPerson` also hides
 *  the person it is about (person reports only). */
export async function resolveReport(id: string, input: ResolveReportInput): Promise<void> {
  const token = await getToken();
  await apiFetch(`/admin/reports/${id}/resolve`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

// --- Visibility (`/admin/visibility`) ---------------------------------------

/** One authenticated, uncached call to `/admin/visibility…`. */
async function visibility(path = '', init: RequestInit = {}): Promise<AdminVisibilityResponse> {
  const token = await getToken();
  return apiFetch<AdminVisibilityResponse>(`/admin/visibility${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token ?? ''}` },
    cache: 'no-store',
  });
}

/** Every read-gate setting: default, current value and who last changed it. */
export const getVisibility = (): Promise<AdminVisibilityResponse> => visibility();

export const updateSectionPolicy = (section: string, policy: SectionPolicy) =>
  visibility(`/sections/${encodeURIComponent(section)}`, { method: 'PUT', body: JSON.stringify(policy) });

export const resetSectionPolicy = (section: string) =>
  visibility(`/sections/${encodeURIComponent(section)}`, { method: 'DELETE' });

export const updateFieldPolicy = (entity: string, field: string, policy: FieldPolicy) =>
  visibility(`/fields/${encodeURIComponent(entity)}/${encodeURIComponent(field)}`, {
    method: 'PUT',
    body: JSON.stringify(policy),
  });

export const resetFieldPolicy = (entity: string, field: string) =>
  visibility(`/fields/${encodeURIComponent(entity)}/${encodeURIComponent(field)}`, { method: 'DELETE' });

export const updateContributionWindow = (days: number) =>
  visibility('/settings/contribution-window', { method: 'PUT', body: JSON.stringify({ days }) });

export const resetContributionWindow = () => visibility('/settings/contribution-window', { method: 'DELETE' });
