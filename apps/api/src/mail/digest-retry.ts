export type DigestSendResult =
  | { status: 'sent'; providerId: string }
  | { status: 'retry' | 'failed'; reason: string }
  | { status: 'disabled' };
export const DIGEST_RETRY_DELAYS = [
  60000, 300000, 1800000, 7200000, 28800000,
] as const;
export const DIGEST_MAX_AGE_MS = 23 * 3600000;
/** The wait before the next attempt, or null once 6 attempts or 23 h since the FIRST attempt
 *  (inside Resend's 24 h idempotency window) would be exceeded. */
export function digestRetryDelay(
  attempts: number,
  firstAttemptAt: Date,
  now: Date,
): number | null {
  const delay = DIGEST_RETRY_DELAYS[attempts - 1];
  return attempts < 6 &&
    delay !== undefined &&
    now.getTime() + delay - firstAttemptAt.getTime() < DIGEST_MAX_AGE_MS
    ? delay
    : null;
}
export function classifyDigestError(error: {
  name?: string;
  statusCode?: number | null;
}): DigestSendResult {
  if (error.name === 'invalid_idempotent_request')
    return { status: 'failed', reason: 'invalid_idempotent_request' };
  if (
    error.name === 'concurrent_idempotent_requests' ||
    error.statusCode === 429 ||
    (error.statusCode ?? 0) >= 500
  )
    return { status: 'retry', reason: 'provider_retry' };
  if ((error.statusCode ?? 0) >= 400)
    return { status: 'failed', reason: 'provider_rejected' };
  return { status: 'retry', reason: 'network_or_timeout' };
}
