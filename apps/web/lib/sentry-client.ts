'use client';

// Browser-side error tracking. The SDK is imported lazily, so it costs nothing
// on a page where no DSN is configured, and only once on a page where it is.

type SentryModule = typeof import('@sentry/nextjs');

let loading: Promise<SentryModule> | null = null;
// Errors reported before init. An error boundary's effect runs before the
// root layout's (children first), so the very first report usually lands here.
const pending: unknown[] = [];

/** Initialise the browser SDK once per page load. */
export function initClientErrorTracking(dsn: string, release?: string) {
  if (loading) return;
  loading = import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({ dsn, release, environment: process.env.NODE_ENV, tracesSampleRate: 0 });
    for (const error of pending.splice(0)) Sentry.captureException(error);
    return Sentry;
  });
}

/** Report an error caught by an error boundary (React swallows those, so the
 *  SDK's global handlers never see them). Held until init; dropped if no DSN
 *  is ever configured. */
export function reportClientError(error: unknown) {
  if (loading) void loading.then((Sentry) => Sentry.captureException(error));
  else if (pending.length < 10) pending.push(error);
}
