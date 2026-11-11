import { domainToASCII } from 'node:url';

import {
  claimDomainMatch,
  hostOf,
  isFreeMailHost,
  isLinkedInHost,
  isPlatformHost,
  isSocialHost,
  normalizeDomain,
} from '@repo/api';
import { getPublicSuffix } from 'tldts';

/**
 * The host an email claim is checked against, or null when this company can't be claimed by
 * email: no domain, a social / platform / free-mail host (it identifies nobody), or a bare
 * public suffix (`co.uk`, `github.io` — every customer of the suffix would pass). Lower-case
 * ASCII (punycode), `www.` stripped.
 */
export function claimableHost(companyDomain: string): string | null {
  const host = toAscii(hostOf(normalizeDomain(companyDomain ?? '')));
  if (!host) return null;
  if (isLinkedInHost(host) || isSocialHost(host) || isPlatformHost(host) || isFreeMailHost(host)) {
    return null;
  }
  if (getPublicSuffix(host, { allowPrivateDomains: true }) === host) return null;
  return host;
}

/** The ASCII host of an email address (`jane@Acmé.com` → `xn--acm-dma.com`), or '' when it has
 *  none worth checking. */
export function emailHost(email: string): string {
  const at = email.trim().lastIndexOf('@');
  if (at < 1) return '';
  return toAscii(email.trim().slice(at + 1).toLowerCase().replace(/\.$/, ''));
}

/** Whether `email` may claim a company whose stored domain is `companyDomain`. */
export function emailMatchesCompany(email: string, companyDomain: string): boolean {
  const stored = claimableHost(companyDomain);
  const host = emailHost(email);
  if (!stored || !host || isFreeMailHost(host)) return false;
  return claimDomainMatch(host, stored);
}

function toAscii(host: string): string {
  if (!host) return '';
  return domainToASCII(host).toLowerCase();
}
