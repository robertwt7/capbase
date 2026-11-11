/**
 * Deciding whether a URL (or an email address's host) identifies the entity that published it.
 * Shared by ingestion (`apps/jobs`, which re-exports it from `util/domain.ts`) and the API's
 * company-claim flow.
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
export const SOCIAL_HOSTS: readonly string[] = [
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
export const PLATFORM_HOSTS: readonly string[] = [
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

/**
 * Consumer mailbox providers. An address here says nothing about where its owner works, so it
 * can never verify a company claim — and a company whose stored domain is one of these can't be
 * claimed by email at all.
 */
export const FREE_MAIL_HOSTS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'zoho.com',
  'fastmail.com',
  'hey.com',
  'tutanota.com',
  'tuta.io',
  'qq.com',
  '163.com',
  '126.com',
  'naver.com',
];

export function isFreeMailHost(host: string): boolean {
  return matches(host, FREE_MAIL_HOSTS);
}

/**
 * The company-claim subdomain rule: an email host passes when it equals the stored host or is
 * a subdomain of it (`eu.acme.com` under `acme.com`). The parent of a stored subdomain does not
 * pass (`acme.com` under `shop.acme.com`), and a bare suffix without a dot boundary never does
 * (`notacme.com`). Both hosts must already be lower-case ASCII (punycode) — the API converts
 * them before calling this.
 */
export function claimDomainMatch(emailHost: string, storedHost: string): boolean {
  if (!emailHost || !storedHost) return false;
  return emailHost === storedHost || emailHost.endsWith(`.${storedHost}`);
}
