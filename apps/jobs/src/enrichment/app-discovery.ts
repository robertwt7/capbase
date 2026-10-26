import { getDomain } from 'tldts';

import { identifyingDomain } from '../util/domain';
import { parseWebsiteLinks } from './website-detector';

export interface DiscoveredAppLink {
  store: 'APPLE' | 'GOOGLE_PLAY';
  appId: string;
  /** Canonical outgoing link; author-supplied tracking parameters are discarded. */
  storeUrl: string;
}

/** Accept product pages on exact store hosts, never search pages or publisher names. */
export function parseStoreAppUrl(raw: string): DiscoveredAppLink | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  if (['apps.apple.com', 'itunes.apple.com'].includes(url.hostname)) {
    const match = /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id([1-9]\d{0,14})\/?$/i.exec(url.pathname);
    if (!match) return null;
    return { store: 'APPLE', appId: match[1]!, storeUrl: `https://apps.apple.com/app/id${match[1]}` };
  }
  if (url.hostname === 'play.google.com' && /^\/store\/apps\/details\/?$/.test(url.pathname)) {
    const ids = url.searchParams.getAll('id');
    const appId = ids[0];
    if (ids.length !== 1 || !appId || appId.length > 255 ||
        !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(appId)) return null;
    return { store: 'GOOGLE_PLAY', appId, storeUrl: `https://play.google.com/store/apps/details?id=${appId}` };
  }
  return null;
}

/** Called only for HTML successfully fetched from the current company website. */
export function discoverAppLinks(html: string, homepageUrl: string): DiscoveredAppLink[] {
  const apps = new Map<string, DiscoveredAppLink>();
  for (const link of parseWebsiteLinks(html, homepageUrl)) {
    const app = parseStoreAppUrl(link);
    if (app) apps.set(`${app.store}:${app.appId}`, app);
    if (apps.size >= 25) break;
  }
  return [...apps.values()].sort((a, b) => `${a.store}:${a.appId}`.localeCompare(`${b.store}:${b.appId}`));
}

export interface AppIdentityCorroboration {
  status: 'DOMAIN_CORROBORATED' | 'UNVERIFIED' | 'DOMAIN_CONFLICT' | 'SHARED_PUBLISHER';
  companyDomain: string | null;
  sellerDomain: string | null;
  /** A matching seller website alone never establishes legal ownership or transfers. */
  requiresOperatorVerification: true;
}

function officialDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = identifyingDomain(url.href);
  if (!host) return null;
  return getDomain(host, { allowPrivateDomains: true });
}

/** An operator can use this evidence when reviewing a candidate. Never matches names. */
export function corroborateAppIdentity(
  companyWebsiteUrl: string,
  sellerWebsiteUrl: string | null | undefined,
  sharedPublisher = false,
): AppIdentityCorroboration {
  const companyDomain = officialDomain(companyWebsiteUrl);
  const sellerDomain = officialDomain(sellerWebsiteUrl);
  const status = sharedPublisher ? 'SHARED_PUBLISHER' : !companyDomain || !sellerDomain ? 'UNVERIFIED' :
    companyDomain === sellerDomain ? 'DOMAIN_CORROBORATED' : 'DOMAIN_CONFLICT';
  return { status, companyDomain, sellerDomain, requiresOperatorVerification: true };
}
