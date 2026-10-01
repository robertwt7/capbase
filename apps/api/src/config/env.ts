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

  const port = str('PORT');
  if (port && !/^\d+$/.test(port)) errors.push(`PORT must be a number, got "${port}"`);

  if (errors.length > 0) {
    throw new Error(`Invalid environment:\n  - ${errors.join('\n  - ')}`);
  }
  return env;
}
