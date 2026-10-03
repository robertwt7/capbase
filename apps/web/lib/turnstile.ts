import { TURNSTILE_HEADER } from '@repo/api';

/**
 * The Turnstile site key, read on the server at request time so one image works
 * in every environment. Pages that host a challenge pass it to their form;
 * unset → no widget, and the API (without `TURNSTILE_SECRET`) skips the check.
 */
export function turnstileSiteKey(): string | undefined {
  return process.env.TURNSTILE_SITE_KEY || undefined;
}

/** Header carrying the widget's token on to the API, when there is one. */
export function turnstileHeaders(token?: string | null): Record<string, string> {
  return token ? { [TURNSTILE_HEADER]: token } : {};
}
