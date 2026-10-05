import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      // Longest match wins, so /api/logo/ stays fetchable under the /api/ block:
      // the company JSON-LD `logo` points there.
      allow: ['/', '/api/logo/'],
      disallow: [
        '/admin',
        '/api/',
        '/profile',
        '/login',
        '/register',
        '/contribute',
        '/companies/*/contribute',
        '/report/',
        '/verify-email',
      ],
    },
    // The index; it points at the per-entity child sitemaps, which are paged
    // because the protocol caps one file at 50,000 URLs.
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
