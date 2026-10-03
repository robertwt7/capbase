// Server-side error tracking (Sentry protocol → self-hosted GlitchTip). Next
// calls register() once per server runtime at boot. SENTRY_DSN is read at
// runtime, so one image serves every environment; unset → nothing loads.
import type { Instrumentation } from 'next';

export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.GIT_SHA || undefined,
    // Errors only — see apps/api/src/instrument.ts.
    tracesSampleRate: 0,
  });
}

/** Errors thrown while rendering a route, in a route handler or a server action. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
};
