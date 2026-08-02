/**
 * Deciding whether a URL identifies the entity that published it.
 *
 * Ingestion matches investors (and companies) by domain, and a domain also
 * resolves the logo — so a domain shared by unrelated entities silently merges
 * them. Real damage seen in the SEC Form ADV roster, where the single "Website
 * Address" cell is whatever the filer typed:
 *   - 3,295 advisers gave a linkedin.com URL,
 *   -    21 gave the same medium.com blog (Founders Fund, Menlo Ventures, …),
 *   -     8 gave their crunchbase.com profile.
 * Matching on those would have collapsed all of them into one investor.
 */

/** Social networks: a link here says nothing about who the entity is. */
const SOCIAL_HOSTS = [
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'youtube.com',
  'tiktok.com',
  'vimeo.com',
  'threads.net',
  'bsky.app',
];

/**
 * Publishing platforms, profile aggregators and site builders. A firm may
 * legitimately link to one, so the URL is worth keeping — but the host belongs
 * to the platform, never to the firm, so it must never be used as a domain.
 */
const PLATFORM_HOSTS = [
  'medium.com',
  'crunchbase.com',
  'wordpress.com',
  'blogspot.com',
  'substack.com',
  'wixsite.com',
  'wix.com',
  'squarespace.com',
  'weebly.com',
  'godaddysites.com',
  'notion.site',
  'notion.so',
  'carrd.co',
  'about.me',
  'angel.co',
  'wellfound.com',
  'sites.google.com',
  'github.io',
  'gitbook.io',
  'bio.link',
  'linktr.ee',
  'pitchbook.com',
  'bloomberg.com',
  'sec.gov',
];

/** Hostname of a URL, scheme-optional, `www.` stripped, lowercased. */
export function hostOf(url: string | null | undefined): string {
  const value = (url ?? '').trim();
  if (!value) return '';
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const host = new URL(withScheme).hostname.replace(/^www\./i, '').toLowerCase();
    // Reject anything that is not really a hostname ("linkedin", "@handle").
    return host.includes('.') ? host : '';
  } catch {
    return '';
  }
}

function matches(host: string, list: readonly string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

export function isLinkedInHost(host: string): boolean {
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

export function isSocialHost(host: string): boolean {
  return matches(host, SOCIAL_HOSTS);
}

export function isPlatformHost(host: string): boolean {
  return matches(host, PLATFORM_HOSTS);
}

/**
 * The domain to store and match on, or null when the URL's host belongs to a
 * platform rather than the entity. Null is the safe answer: matching then falls
 * back to the normalized name, which never merges unrelated firms.
 */
export function identifyingDomain(url: string | null | undefined): string | null {
  const host = hostOf(url);
  if (!host) return null;
  if (isLinkedInHost(host) || isSocialHost(host) || isPlatformHost(host)) return null;
  return host;
}
