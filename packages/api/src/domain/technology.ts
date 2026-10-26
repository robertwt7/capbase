/** Observable public website signals, never an inventory of internal software. */
export interface CompanyTechnology {
  id: string;
  slug: string;
  name: string;
  category: string;
  vendorUrl: string;
  evidenceUrl: string;
  evidence: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Verified outgoing store links. Catalog metrics are intentionally absent. */
export interface CompanyApp {
  id: string;
  store: 'APPLE' | 'GOOGLE_PLAY';
  appId: string;
  storeUrl: string;
  evidenceUrl: string;
  verifiedAt: string;
  lastSeenAt: string;
}

export const WEBSITE_EXPIRY_MS = 60 * 86_400_000;

/** Homepage identity shared by collection and projection. Network safety is checked by jobs. */
export function canonicalWebsiteTarget(websiteUrl: string | null | undefined, domain?: string): string | null {
  const raw = websiteUrl?.trim() || (domain?.trim() ? `https://${domain.trim()}` : '');
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!url.hostname.includes('.') || url.hostname.endsWith('.')) return null;
    return `${url.origin}/`;
  } catch {
    return null;
  }
}
