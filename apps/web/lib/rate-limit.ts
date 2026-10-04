/**
 * What the web shows for a 429, from the API's throttler or from nginx in front of
 * the site (whose 429 is an HTML page, so a form can't read a message from it).
 * Its own module so client components can import it: lib/api.ts reads request
 * headers and is server-only.
 */
export const RATE_LIMITED_MESSAGE = 'Too many requests. Please wait a minute and try again.';
