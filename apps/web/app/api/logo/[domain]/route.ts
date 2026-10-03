// Company logo proxy: /api/logo/<domain> → the site's favicon via DuckDuckGo's
// icon service. Same-origin on purpose:
//  - an unknown domain answers a clean 404 (DuckDuckGo serves a generic
//    placeholder *image* with its 404, which browsers would happily render),
//    so <CompanyLogo> falls back to the monogram;
//  - the CSP img-src stays 'self'.
// Clearbit's logo API, the previous source, was shut down.
//
// Nothing is cached server-side (36k domains would bloat the Next data cache
// on a small box); browsers and any CDN cache the response for a week.

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const WEEK = 60 * 60 * 24 * 7;

function miss(status = 404) {
  return new Response(null, {
    status,
    headers: { 'Cache-Control': `public, max-age=${WEEK / 7}` },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ domain: string }> }) {
  const domain = (await params).domain.toLowerCase();
  if (!DOMAIN_RE.test(domain)) return miss(400);

  try {
    const res = await fetch(`https://icons.duckduckgo.com/ip3/${domain}.ico`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return miss();
    return new Response(res.body, {
      headers: {
        'Content-Type': type,
        'Cache-Control': `public, max-age=${WEEK}, stale-while-revalidate=${WEEK}`,
      },
    });
  } catch {
    return miss(502);
  }
}
