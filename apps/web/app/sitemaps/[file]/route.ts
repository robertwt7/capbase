import { entriesFor, parseSitemapFile, renderUrlSet } from '@/lib/sitemap';

export const dynamic = 'force-dynamic';

/** One child sitemap: `/sitemaps/people-1.xml`. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  const parsed = parseSitemapFile(file);
  // A name that matches no family is a 404, not an empty sitemap — an empty
  // one would tell a crawler the page legitimately holds nothing.
  if (!parsed) return new Response('Not found', { status: 404 });

  const body = renderUrlSet(await entriesFor(parsed.kind, parsed.page));
  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600',
    },
  });
}
