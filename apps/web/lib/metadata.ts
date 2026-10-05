import type { Metadata } from 'next';

import { SITE_NAME } from './site';

/**
 * Canonical URL and og:url for one page, always together. Next merges metadata
 * shallowly per key, so setting `openGraph` here replaces the root object — that
 * is why siteName/type are repeated rather than inherited. A page that never
 * calls this emits no canonical and no og:url (the root layout claims neither).
 */
export function canonical(path: string): Pick<Metadata, 'alternates' | 'openGraph'> {
  return {
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: SITE_NAME, url: path },
  };
}
