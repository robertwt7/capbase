// Error tracking (Sentry protocol → self-hosted GlitchTip). Imported first in
// every entrypoint, before Nest, so the SDK can hook modules as they load.
// A no-op when SENTRY_DSN is unset (local dev, CI, tests).
import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.NODE_ENV ?? 'development',
  release: process.env.GIT_SHA || undefined,
  serverName: 'api',
  // Errors only: GlitchTip's performance support is minimal and tracing costs
  // CPU on a small box.
  tracesSampleRate: 0,
});
