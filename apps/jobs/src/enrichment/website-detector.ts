import { Parser } from 'htmlparser2';

export const DETECTOR_VERSION = 'website-2026-10-26.1';
export interface TechnologyDetection { slug: string; ruleId: string; evidence: string }

/** Parse attributes, never comments, quoted prose or JavaScript string contents. */
export function parseWebsiteTags(html: string): { name: string; attrs: Record<string, string> }[] {
  const tags: { name: string; attrs: Record<string, string> }[] = [];
  const parser = new Parser({ onopentag: (name, attrs) => tags.push({ name, attrs }) });
  parser.end(html.slice(0, 1_048_576));
  return tags;
}

export function parseWebsiteLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  for (const { name, attrs } of parseWebsiteTags(html)) {
    if (name !== 'a' || !attrs.href) continue;
    try {
      const url = new URL(attrs.href, baseUrl);
      if (/^https?:$/.test(url.protocol) && !url.username && !url.password) links.add(url.href);
    } catch { /* malformed author-supplied link */ }
    if (links.size >= 500) break;
  }
  return [...links];
}

/** Evidence descriptors are fixed text: no publisher IDs, query strings or page contents. */
export function detectTechnologies(
  html: string,
  _headers: Record<string, string> = {},
  baseUrl = 'https://website.invalid/',
): TechnologyDetection[] {
  void _headers;
  const found = new Map<string, TechnologyDetection>();
  const add = (slug: string, ruleId: string, evidence: string) => {
    if (!found.has(slug)) found.set(slug, { slug, ruleId, evidence });
  };
  for (const { name, attrs } of parseWebsiteTags(html)) {
    if (name === 'meta' && attrs.name?.toLowerCase() === 'generator') {
      const value = attrs.content ?? '';
      for (const [slug, signature] of [
        ['wordpress', /^WordPress(?:\s|$)/i], ['drupal', /^Drupal(?:\s|$)/i],
        ['ghost', /^Ghost(?:\s|$)/i], ['webflow', /^Webflow(?:\s|$)/i],
        ['wix', /^Wix(?:\.com)?(?:\s|$)/i], ['squarespace', /^Squarespace(?:\s|$)/i],
        ['gatsby', /^Gatsby(?:\s|$)/i], ['astro', /^Astro(?:\s|$)/i],
      ] as const) {
        if (signature.test(value)) add(slug, `${slug}-generator`, `Explicit ${slug} generator metadata`);
      }
    }
    if (name !== 'script' || !attrs.src) continue;
    let script: URL;
    try { script = new URL(attrs.src, baseUrl); } catch { continue; }
    if (!/^https?:$/.test(script.protocol) || script.username || script.password) continue;
    const host = script.hostname;
    const path = script.pathname;
    const ownHost = host === new URL(baseUrl).hostname;
    const rules: [string, boolean, string][] = [
      ['shopify', host === 'cdn.shopify.com' && /^\/s\/files\//.test(path), 'cdn.shopify.com/s/files/ script'],
      ['nextjs', ownHost && /^\/_next\/static\/.+\.js$/.test(path), '/_next/static/ JavaScript artifact'],
      ['nuxt', ownHost && /^\/_nuxt\/.+\.m?js$/.test(path), '/_nuxt/ JavaScript artifact'],
      ['sveltekit', ownHost && /^\/_app\/immutable\/entry\/(?:start|app)\.[\w-]+\.js$/.test(path), 'SvelteKit immutable entry artifact'],
      ['google-analytics', host === 'www.google-analytics.com' && /^\/(?:analytics|ga)\.js$/.test(path), 'Google Analytics script endpoint'],
      ['google-analytics', host === 'www.googletagmanager.com' && path === '/gtag/js' && /^(?:G|UA)-[A-Z0-9-]+$/.test(script.searchParams.get('id') ?? ''), 'Google Analytics gtag endpoint'],
      ['google-tag-manager', host === 'www.googletagmanager.com' && path === '/gtm.js' && /^GTM-[A-Z0-9]+$/.test(script.searchParams.get('id') ?? ''), 'Google Tag Manager script endpoint'],
      ['plausible', host === 'plausible.io' && /^\/js\/script(?:\.[a-z-]+)*\.js$/.test(path), 'plausible.io analytics script'],
      ['matomo', host.endsWith('.matomo.cloud') && path === '/matomo.js', 'Matomo Cloud analytics script'],
      ['intercom', host === 'widget.intercom.io' && /^\/widget\/[a-z0-9]+$/.test(path), 'Intercom widget script'],
      ['hubspot', /^(?:js\.hs-scripts\.com|js-[a-z0-9]+\.hs-scripts\.com)$/.test(host) && /^\/\d+\.js$/.test(path), 'HubSpot hosted tracking script'],
      ['zendesk', host === 'static.zdassets.com' && path === '/ekr/snippet.js', 'Zendesk support widget script'],
      ['crisp', host === 'client.crisp.chat' && path === '/l.js', 'Crisp support widget script'],
    ];
    for (const [slug, matched, evidence] of rules) {
      if (matched) add(slug, `${slug}-script`, evidence);
    }
  }
  return [...found.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

export function isBlockedPage(html: string): boolean {
  return /(?:cf-chl-|challenge-platform\/|<title>\s*(?:Just a moment|Attention Required|Access Denied|Robot Check)|captcha-delivery\.com|This domain (?:is for sale|has expired)|sedoparking\.com|<title>[^<]*(?:sign in|log in|login)\b)/i.test(html.slice(0, 1_048_576));
}
