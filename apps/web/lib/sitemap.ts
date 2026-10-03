// Sitemap generation.
//
// Two constraints shape this, and neither is satisfied by Next's `app/sitemap.ts`
// metadata convention:
//
//  1. **It must not be prerendered.** That convention bakes the XML at build
//     time, and a `docker build` has no network route to the `api` service — so
//     every slug fetch hit its `catch` and the deployed sitemap advertised 26
//     URLs instead of ~120,000. Route handlers marked `force-dynamic` render on
//     request, when the API is reachable.
//  2. **It must be split.** The sitemap protocol caps one file at 50,000 URLs;
//     people alone are past that. `generateSitemaps()` would handle the split
//     but needs the chunk count at BUILD time, which is the same unavailable
//     fetch — so the index is computed here, per request, from real counts.

import { SECTORS } from '@repo/api';

import { getCompanySlugs, getInvestorSlugs, getPersonSlugs } from './data';
import { sectorSlug } from './markets';
import { SITE_URL } from './site';

/** The sitemap protocol's hard cap. Also keeps each file far under the 50MB
 *  uncompressed limit, which we would never approach at this URL length. */
export const URLS_PER_SITEMAP = 45_000;

/** Pages that exist regardless of the data. */
const STATIC_PATHS = [
  '',
  '/companies',
  '/investors',
  '/people',
  '/funds',
  '/markets',
  '/about',
  '/faq',
  '/data',
  '/alternatives/crunchbase',
  '/alternatives/pitchbook',
  '/terms',
  '/privacy',
  '/takedown',
];

export interface SitemapEntry {
  url: string;
  lastModified?: string;
}

/** The entity families that need paging. `static` is a single file. */
export type SitemapKind = 'static' | 'companies' | 'investors' | 'people';

const LOADERS: Record<Exclude<SitemapKind, 'static'>, () => Promise<{ slug: string; updatedAt: string }[]>> = {
  companies: getCompanySlugs,
  investors: getInvestorSlugs,
  people: getPersonSlugs,
};

/** `/companies/acme` etc. — the path prefix each family's slugs hang off. */
const PREFIX: Record<Exclude<SitemapKind, 'static'>, string> = {
  companies: '/companies',
  investors: '/investors',
  people: '/people',
};

/** Escape the five XML metacharacters. Slugs are kebab-case today, so this is
 *  belt-and-braces — but a sitemap that emits raw text is one odd slug away
 *  from being unparseable, and Google drops the whole file when that happens. */
function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderUrlSet(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const lastmod = e.lastModified ? `<lastmod>${xml(e.lastModified)}</lastmod>` : '';
      return `<url><loc>${xml(e.url)}</loc>${lastmod}</url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export function renderIndex(files: string[]): string {
  const entries = files
    .map((f) => `<sitemap><loc>${xml(`${SITE_URL}/sitemaps/${f}`)}</loc></sitemap>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`;
}

/** The static page set: the fixed paths plus one page per market sector. */
export function staticEntries(): SitemapEntry[] {
  return [
    ...STATIC_PATHS.map((p) => ({ url: `${SITE_URL}${p}` })),
    ...SECTORS.map((s) => ({ url: `${SITE_URL}/markets/${sectorSlug(s)}` })),
  ];
}

/** One page of one family's URLs. An out-of-range page yields an empty set
 *  rather than a 404 — a crawler that indexed `people-3.xml` before the corpus
 *  shrank should see "nothing here", not an error. */
export async function entriesFor(kind: SitemapKind, page: number): Promise<SitemapEntry[]> {
  if (kind === 'static') return page === 0 ? staticEntries() : [];

  const rows = await LOADERS[kind]();
  return rows.slice(page * URLS_PER_SITEMAP, (page + 1) * URLS_PER_SITEMAP).map((r) => ({
    url: `${SITE_URL}${PREFIX[kind]}/${r.slug}`,
    lastModified: r.updatedAt,
  }));
}

/**
 * Every child sitemap the index should list, from the live counts.
 *
 * A family that returns nothing contributes no file: an empty sitemap in the
 * index is a promise of content that isn't there, and it is also how the old
 * build-time failure hid — 26 URLs looked like a valid sitemap.
 */
export async function indexFiles(): Promise<string[]> {
  const [companies, investors, people] = await Promise.all([
    getCompanySlugs(),
    getInvestorSlugs(),
    getPersonSlugs(),
  ]);

  const files = ['static.xml'];
  for (const [kind, rows] of [
    ['companies', companies],
    ['investors', investors],
    ['people', people],
  ] as const) {
    const pages = Math.ceil(rows.length / URLS_PER_SITEMAP);
    for (let i = 0; i < pages; i++) files.push(`${kind}-${i}.xml`);
  }
  return files;
}

/** `people-1.xml` → { kind: 'people', page: 1 }; null when it names nothing. */
export function parseSitemapFile(file: string): { kind: SitemapKind; page: number } | null {
  if (file === 'static.xml') return { kind: 'static', page: 0 };
  const match = /^(companies|investors|people)-(\d+)\.xml$/.exec(file);
  if (!match) return null;
  return { kind: match[1] as SitemapKind, page: Number(match[2]) };
}
