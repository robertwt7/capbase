import { CronTime } from 'cron';

import { DEFAULT_QUEUE_DIGEST_CRON } from '../admin/queue-alerts.service';

/**
 * Boot-time env validation for ConfigModule. Fails fast with every problem at
 * once rather than on the first request that happens to read a missing key.
 *
 * Secret strength is only enforced in production, so the checked-in
 * `.env.example` placeholder keeps working for local dev and CI.
 */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];
  const isProd = env.NODE_ENV === 'production';
  const str = (key: string) => (typeof env[key] === 'string' ? (env[key] as string) : '');

  if (!str('DATABASE_URL')) errors.push('DATABASE_URL is required');

  const secret = str('JWT_SECRET');
  if (!secret) errors.push('JWT_SECRET is required');
  else if (isProd && secret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters in production');
  } else if (isProd && secret === 'change-me-in-production') {
    errors.push('JWT_SECRET is still the .env.example placeholder');
  }

  const dsn = str('SENTRY_DSN');
  if (dsn && !/^https?:\/\/[^@\s]+@[^/\s]+\/\d+$/.test(dsn)) {
    errors.push('SENTRY_DSN must look like https://<key>@<host>/<project-id>');
  }

  const threshold = str('QUEUE_ALERT_THRESHOLD');
  if (threshold && !/^\d+$/.test(threshold)) {
    errors.push(`QUEUE_ALERT_THRESHOLD must be a whole number (0 turns it off), got "${threshold}"`);
  }
  // A bad schedule would otherwise throw from the cron at bootstrap and take the API down.
  const digestCron = str('QUEUE_DIGEST_CRON');
  const digestTz = str('QUEUE_DIGEST_TZ');
  if (digestCron || digestTz) {
    try {
      new CronTime(digestCron || DEFAULT_QUEUE_DIGEST_CRON, digestTz || 'UTC');
    } catch (err) {
      errors.push(`QUEUE_DIGEST_CRON / QUEUE_DIGEST_TZ is invalid: ${(err as Error).message}`);
    }
  }

  const port = str('PORT');
  if (port && !/^\d+$/.test(port)) errors.push(`PORT must be a number, got "${port}"`);

  if (errors.length > 0) {
    throw new Error(`Invalid environment:\n  - ${errors.join('\n  - ')}`);
  }
  return env;
}
