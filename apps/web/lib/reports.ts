import type { CreateReportInput } from '@repo/api';

import { ApiError, apiFetch } from './api';
import { turnstileHeaders } from './turnstile';

/** File a "Report an issue". Deliberately sends NO authorization header —
 *  reports are anonymous even when the visitor happens to be signed in. */
export function submitReport(
  input: CreateReportInput,
  turnstileToken?: string | null,
) {
  return apiFetch<{ id: string }>('/reports', {
    method: 'POST',
    headers: turnstileHeaders(turnstileToken),
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

export function reportErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      const message = (err.body as { message?: unknown } | undefined)?.message;
      return typeof message === 'string'
        ? message
        : 'Human verification failed. Please retry.';
    }
    if (err.status === 404) return 'This profile no longer exists.';
    if (err.status === 429)
      return 'Too many requests. Please wait a minute and try again.';
  }
  return 'Your report could not be sent. Please try again.';
}
