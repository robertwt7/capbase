import { TECHNOLOGY_CATALOG } from './technology-catalog';
import { detectTechnologies, isBlockedPage, parseWebsiteLinks } from './website-detector';

const signatures: Record<string, string> = {
  wordpress: '<meta name="generator" content="WordPress 6.8">',
  drupal: '<meta name="generator" content="Drupal 11">',
  ghost: '<meta name="generator" content="Ghost 6.0">',
  webflow: '<meta name="generator" content="Webflow">',
  wix: '<meta name="generator" content="Wix.com Website Builder">',
  squarespace: '<meta name="generator" content="Squarespace">',
  shopify: '<script src="https://cdn.shopify.com/s/files/1/theme.js"></script>',
  nextjs: '<script src="/_next/static/chunks/app.js"></script>',
  nuxt: '<script src="/_nuxt/entry.js"></script>',
  gatsby: '<meta name="generator" content="Gatsby 5.0">',
  astro: '<meta name="generator" content="Astro v5.0">',
  sveltekit: '<script src="/_app/immutable/entry/start.Daz-123.js"></script>',
  'google-analytics': '<script src="https://www.googletagmanager.com/gtag/js?id=G-123ABC"></script>',
  'google-tag-manager': '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-123ABC"></script>',
  plausible: '<script src="https://plausible.io/js/script.js"></script>',
  matomo: '<script src="https://example.matomo.cloud/matomo.js"></script>',
  intercom: '<script src="https://widget.intercom.io/widget/abc123"></script>',
  hubspot: '<script src="https://js.hs-scripts.com/123456.js"></script>',
  zendesk: '<script src="https://static.zdassets.com/ekr/snippet.js?key=SECRET"></script>',
  crisp: '<script src="https://client.crisp.chat/l.js"></script>',
};

describe('original website fingerprints', () => {
  it.each(TECHNOLOGY_CATALOG.map(({ slug }) => [slug]))('detects %s with bounded fixed evidence', (slug) => {
    const detections = detectTechnologies(signatures[slug]!);
    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({ slug });
    expect(detections[0]!.evidence.length).toBeLessThan(150);
    expect(detections[0]!.evidence).not.toMatch(/SECRET|123456|abc123/);
    expect(detectTechnologies(`${signatures[slug]}${signatures[slug]}`)).toEqual(detections);
  });
  it('does not infer from prose, comments, inline code, lookalike hosts or near-match paths', () => {
    expect(detectTechnologies(`
      <p>Our WordPress and Shopify integration is great</p>
      <!-- <meta name="generator" content="WordPress"> -->
      <script>const text = '<meta name="generator" content="Drupal">';</script>
      <meta name="generator" content="WordPresses">
      <script src="https://plausible.io.attacker.com/js/script.js"></script>
      <script src="https://cdn.shopify.com.attacker.com/s/files/theme.js"></script>
      <script src="/assets/_next/static/chunks/app.js"></script>
      <script src="https://unrelated.com/_next/static/chunks/app.js"></script>
      <script src="https://www.googletagmanager.com/gtm.js?id=G-1234"></script>
      <script src="https://notmatomo.cloud/matomo.js"></script>
    `)).toEqual([]);
  });
  it('handles empty and removed signatures deterministically', () => {
    expect(detectTechnologies('')).toEqual([]);
    expect(detectTechnologies('<html><body>Simple page</body></html>')).toEqual([]);
  });
  it.each([
    '<title>Just a moment...</title>', '<script src="/cdn-cgi/challenge-platform/abc"></script>',
    '<title>Sign in</title>', '<p>This domain is for sale</p>',
  ])('classifies unusable page %s', (html) => expect(isBlockedPage(html)).toBe(true));
  it('parses explicit anchor links only with a bounded count', () => {
    expect(parseWebsiteLinks('<a href="/app">App</a><!-- <a href="https://evil.com"> --> <script>"<a href="/not-real">"</script><a href="javascript:alert(1)">', 'https://example.com/')).toEqual(['https://example.com/app']);
    expect(parseWebsiteLinks('<a href="/a">A</a>'.repeat(1000), 'https://example.com/')).toHaveLength(1);
  });
});
