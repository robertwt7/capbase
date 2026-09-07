import { indexFiles, renderIndex } from '@/lib/sitemap';

// Rendered per request, never at build time. See lib/sitemap.ts for why: a
// container build cannot reach the API, and a prerendered sitemap silently
// froze at 26 URLs.
export const dynamic = 'force-dynamic';

/** The sitemap index — the one URL robots.txt advertises. */
export async function GET(): Promise<Response> {
  const body = renderIndex(await indexFiles());
  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // Crawlers re-fetch rarely; an hour keeps the index cheap without letting
      // a new company wait a day to be discovered.
      'cache-control': 'public, max-age=0, s-maxage=3600',
    },
  });
}
