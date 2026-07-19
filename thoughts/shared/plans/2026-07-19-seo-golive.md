# SEO Go-Live Implementation Plan

## Overview

Make capbase.fyi launch-ready for search: full technical SEO (metadata, sitemap, robots,
canonicals, structured data, OG images), keyword-targeted content pages (FAQ, About,
`/alternatives/crunchbase`, `/alternatives/pitchbook`), legal pages (Terms, Privacy), a site
footer to link it all, and GA4 analytics.

**Decisions locked in with the user (no open questions):**

| Decision | Value |
| --- | --- |
| Production origin | `https://capbase.fyi` (domain purchased) |
| Keyword strategy | Dedicated comparison pages + About + FAQ + homepage copy |
| Legal entity | Individual operator, based in Australia |
| Governing law | Australia |
| Contact email | `support@capbase.fyi` |
| Analytics | Google Analytics 4 (via `@next/third-parties`) |
| Cookie banner | **None at launch.** AU law doesn't mandate one; the Privacy Policy discloses GA4 cookies. Revisit only if EU traffic becomes a priority. |
| Demo-data disclaimer | Remove as part of go-live |

**Target keyword → URL map:**

| Keyword cluster | Target URL | Vehicle |
| --- | --- | --- |
| crunchbase alternative / free crunchbase alternative | `/alternatives/crunchbase` | Comparison landing page |
| pitchbook alternative | `/alternatives/pitchbook` | Comparison landing page |
| free company data / free startup funding data | `/` + `/companies` | Homepage title/description/copy, directory metadata |
| crowdsourced company data / open company database | `/about` | Open-data story page |
| `{company name}` funding / investors | `/companies/[slug]` | `generateMetadata` + Organization JSON-LD |
| `{sector}` startups / funding | `/markets/[sector]` | `generateMetadata` |
| long-tail questions ("is crunchbase free", …) | `/faq` | FAQ + `FAQPage` JSON-LD |

## Current State Analysis

- The **only** metadata in the app is the root static export at `apps/web/app/layout.tsx:25`
  (title + description). No `metadataBase`, no title template, no OG/Twitter, no icons.
- Two pages export title-only metadata (`app/compare/page.tsx:11`,
  `app/(account)/profile/settings/page.tsx:8`).
- `/markets/[sector]` has `generateStaticParams` (`app/markets/[sector]/page.tsx:19`) but no
  `generateMetadata`. `/companies/[slug]` has neither.
- **No** `sitemap.ts`, `robots.ts`, favicon (`app/icon.*`), FAQ, About, Terms, Privacy, footer,
  or JSON-LD anywhere. `public/` still holds default Next/Turborepo SVGs.
- The API has no way to enumerate company slugs — `GET /companies` is paginated with full
  payloads (`apps/api/src/companies/companies.controller.ts:26`). A sitemap needs a
  lightweight endpoint.
- `Company` rows carry `slug @unique`, `updatedAt`, `moderationStatus` with an index
  (`packages/db/prisma/schema.prisma:52,85,89,101`) — a slugs query is cheap. **No schema
  changes needed.**
- Company profile footer says "Figures shown are illustrative demo data"
  (`app/companies/[slug]/page.tsx:316-318`).
- Locked-content model: logged-out crawlers see partial lists + a visible "Showing X of Y"
  note (`LockNote`, `page.tsx:323`). Because the page *tells* the viewer content is gated and
  Googlebot sees the same page as any logged-out user, this is standard freemium gating, not
  cloaking. No change needed; do **not** special-case bot user agents.
- API workspace has jest specs (`apps/api/src/companies/companies.service.spec.ts`) — new
  endpoint gets a spec.
- `lib/api.ts` gives all public reads 60s ISR — good crawl/cache foundation, reused by the
  sitemap and OG image routes.

## Desired End State

- Every public route renders a unique `<title>`, meta description, canonical URL, and OG/Twitter
  tags; private routes (`/admin`, `/profile`, auth, contribute flows) are noindexed and
  disallowed.
- `https://capbase.fyi/sitemap.xml` lists all static routes, 14 sector pages, and every
  APPROVED company; `robots.txt` points to it.
- `/faq`, `/about`, `/alternatives/crunchbase`, `/alternatives/pitchbook`, `/terms`, `/privacy`
  exist, are linked from a new site footer, and carry the target keywords.
- Home emits `WebSite` + `Organization` JSON-LD; company pages emit `Organization` +
  `BreadcrumbList`; FAQ and alternatives pages emit `FAQPage`.
- Sharing any company link produces a branded monochrome social card with the company name and
  total raised; every other page gets the default Capbase card.
- GA4 records page views when `NEXT_PUBLIC_GA_ID` is set; silent no-op otherwise.
- `yarn lint` (strict, `--max-warnings 0`) and `yarn build` pass; `yarn workspace api test` passes.

### Key Discoveries

- Nest route ordering: the new `@Get('sitemap')` **must be declared before** `@Get(':slug')` in
  `companies.controller.ts` or it will be swallowed by the slug param route.
- `RootLayout` is a server component, so `NEXT_PUBLIC_GA_ID` can be read at **runtime** on the
  server and passed as a prop to `<GoogleAnalytics>` — no Docker build-arg needed.
- `next/og` `ImageResponse` requires font data as `ArrayBuffer`; `next/font` doesn't expose
  files. Vendor two OFL-licensed `.ttf` files and load via
  `fetch(new URL('./file.ttf', import.meta.url))` so the bundler traces them into the
  standalone Docker output.
- `sectorSlug`/`sectorFromSlug` (`apps/web/lib/markets.ts`) already provide sector URLs for the
  sitemap and sector metadata.
- Existing `lib/data.ts` getters fall back to mocks when the API is down; the new
  `getCompanySlugs()` should fall back to `[]` instead (a mock-seeded sitemap in prod would be
  harmful).

## What We're NOT Doing

- No blog / content-marketing engine, no `/alternatives` index page beyond the two competitors
  (config is extensible for later: zoominfo, dealroom, …).
- No cookie-consent banner (decision above).
- No investor detail pages (none exist; `/investors` stays a single directory URL).
- No `generateSitemaps` sharding — single sitemap is fine below 50k companies; noted as a
  future trigger, not built now.
- No hreflang/i18n, no `next-sitemap` package (native App Router files instead), no
  Bing/IndexNow, no Dataset schema for funding rounds, no per-sector OG images.
- No changes to the locked-content/unlock model.
- No header nav changes (About/FAQ live in the new footer).

## Implementation Approach

Five phases, each independently shippable and verifiable. Phase 1 lays the technical rails
(URL config, metadata, robots, sitemap + API endpoint, icons, noindex). Phase 2 builds the
keyword content surface (footer, FAQ, About, alternatives). Phase 3 adds the legal pages.
Phase 4 adds structured data and OG images. Phase 5 wires analytics and go-live polish.

All new UI follows the design system: monochrome graphite, `font-display` headlines,
`font-mono` meta labels, existing `ui/` primitives, **no CSS Modules, no hex values**.

---

## Phase 1: Technical SEO Foundation

### Overview
Central site-URL config, full metadata coverage (root + per-route), `robots.ts`,
`sitemap.ts` backed by a new lightweight API endpoint, favicon, noindex on private routes.

### Changes Required:

#### 1. Site config seam
**File**: `apps/web/lib/site.ts` (new)

```ts
// Canonical site origin for metadata, sitemap, robots, JSON-LD, and OG URLs.
// Server-only (read in RSCs / metadata routes), so a plain env var is fine.
export const SITE_URL = process.env.SITE_URL ?? 'https://capbase.fyi';
export const SITE_NAME = 'Capbase';
export const SUPPORT_EMAIL = 'support@capbase.fyi';
```

Add `SITE_URL` to `apps/web/.env.example` (create if absent) and to the `web` service
environment in `docker-compose.yml`.

#### 2. Root metadata overhaul
**File**: `apps/web/app/layout.tsx`
**Changes**: replace the static `metadata` export:

```ts
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Capbase — Free Company & Startup Funding Data',
    template: '%s — Capbase',
  },
  description:
    'Funding rounds, investors, people, and market data for private companies — a free, crowdsourced, open-source alternative to Crunchbase and PitchBook.',
  openGraph: {
    type: 'website',
    siteName: 'Capbase',
    url: '/',
  },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/' },
};
```

(The default OG image arrives in Phase 4 via `app/opengraph-image.tsx`; Next auto-injects it.)

#### 3. Favicon
**File**: `apps/web/app/icon.svg` (new) — the stepped-corner mark from `SiteHeader.tsx:18`
as an SVG (ink square with the notch cut out, matching
`polygon(0 0, 100% 0, 100% 60%, 60% 60%, 60% 100%, 0 100%)`). Delete the unused default
SVGs in `apps/web/public/` (`next.svg`, `vercel.svg`, `turborepo-*.svg`, `globe.svg`,
`window.svg`, `file-text.svg`) after grepping to confirm nothing references them.

#### 4. API: slugs endpoint for the sitemap
**Files**: `apps/api/src/companies/companies.controller.ts`,
`companies.service.ts`, `companies.service.spec.ts`

```ts
// companies.controller.ts — MUST be declared BEFORE @Get(':slug')
@Get('sitemap')
sitemap() {
  return this.companiesService.listSlugs();
}
```

```ts
// companies.service.ts
async listSlugs(): Promise<Array<{ slug: string; updatedAt: string }>> {
  const rows = await this.prisma.company.findMany({
    where: { moderationStatus: 'APPROVED' },
    select: { slug: true, updatedAt: true },
    orderBy: { slug: 'asc' },
  });
  return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
}
```

Add a `CompanySlugEntry` type to `packages/api` (`domain/company.ts`) so web and api share it.
Spec: `listSlugs` returns only APPROVED rows, ISO dates, and the controller route resolves
`/companies/sitemap` (not the `:slug` handler).

#### 5. Web data getter
**File**: `apps/web/lib/data.ts`

```ts
export async function getCompanySlugs(): Promise<CompanySlugEntry[]> {
  try {
    return await apiFetch<CompanySlugEntry[]>('/companies/sitemap');
  } catch {
    return []; // never emit mock slugs into a production sitemap
  }
}
```

#### 6. robots + sitemap
**Files**: `apps/web/app/robots.ts`, `apps/web/app/sitemap.ts` (new)

```ts
// robots.ts
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api/', '/profile', '/login', '/register', '/contribute', '/companies/*/contribute'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
```

```ts
// sitemap.ts — static routes + 14 sectors (SECTORS × sectorSlug) + approved companies
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const companies = await getCompanySlugs();
  return [
    ...['', '/companies', '/investors', '/markets', '/about', '/faq',
        '/alternatives/crunchbase', '/alternatives/pitchbook', '/terms', '/privacy']
      .map((p) => ({ url: `${SITE_URL}${p}` })),
    ...SECTORS.map((s) => ({ url: `${SITE_URL}/markets/${sectorSlug(s)}` })),
    ...companies.map((c) => ({
      url: `${SITE_URL}/companies/${c.slug}`,
      lastModified: c.updatedAt,
    })),
  ];
}
```

(FAQ/About/alternatives/legal URLs land in Phases 2–3; shipping them in the sitemap in the
same release is fine as long as Phase 1–3 deploy together. If Phase 1 deploys alone first,
comment those four lines until the pages exist.)

#### 7. Per-route metadata
**Files**:
- `app/companies/[slug]/page.tsx` — add `generateMetadata`: title
  `` `${company.name} — Funding, Investors & Profile` ``, description built from `oneLiner` +
  founded/HQ/total raised (truncate ≈160 chars), `alternates.canonical: /companies/${slug}`.
  Wrap `getCompanyDetail` in React `cache()` in `lib/data.ts` so metadata + page + (Phase 4)
  OG image share one fetch per request.
- `app/markets/[sector]/page.tsx` — `generateMetadata`: title
  `` `${sector} Startups — Funding & Market Data` ``, description from live sector stats,
  canonical `/markets/${slug}`. Unknown slug → `{}` (page already 404s).
- `app/companies/page.tsx` — static metadata: "Company Directory — Free Startup Funding
  Data", canonical `/companies` (bare path; filter/page query variants canonicalise to it).
- `app/investors/page.tsx` — "Investor Directory — VCs, Angels & Funds", canonical `/investors`.
- `app/markets/page.tsx` — "Startup Market Data by Sector", canonical `/markets`.

#### 8. Noindex private routes
Add `robots: { index: false, follow: false }` metadata to: `app/admin/layout.tsx`,
`app/admin/login/page.tsx`, `app/(account)/login/page.tsx`, `app/(account)/register/page.tsx`,
`app/(account)/profile/page.tsx`, `app/(account)/profile/settings/page.tsx`,
`app/contribute/page.tsx`, `app/companies/[slug]/contribute/page.tsx`. (Redundant with the
robots.txt disallow — deliberate belt-and-braces; harmless.) `/compare` stays indexable with
its existing title plus a canonical of `/compare`.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build` passes across the monorepo
- [x] `yarn lint` passes (strict, `--max-warnings 0`)
- [x] `yarn workspace api test` passes (incl. new `listSlugs` spec)
- [x] `curl -s localhost:3000/companies/sitemap` returns `[{"slug":...,"updatedAt":...}]` (api running)
- [x] `curl -s localhost:3001/robots.txt` shows disallows + sitemap line (web running)
- [x] `curl -s localhost:3001/sitemap.xml` includes `/markets/fintech` and at least one company URL (11,056 company URLs)
- [x] `curl -s localhost:3001/companies/<seeded-slug> | grep -o '<title>[^<]*'` shows the company name (`1000Memories — Funding, Investors & Profile — Capbase`)

#### Manual Verification:
- [ ] View source on a company page: unique title, description, canonical, OG tags present
- [ ] `/login` and `/admin` render `<meta name="robots" content="noindex, nofollow">`
- [ ] Favicon renders in the browser tab

**Implementation Note**: pause here for manual confirmation before Phase 2.

---

## Phase 2: Footer + Keyword Content Pages (FAQ, About, Alternatives)

### Overview
A site footer (the internal-link spine), the FAQ page with `FAQPage` JSON-LD, the About page,
and the two comparison landing pages. Plus the homepage copy tweak.

### Changes Required:

#### 1. JSON-LD helper
**File**: `apps/web/components/JsonLd.tsx` (new)

```tsx
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
```

#### 2. Site footer
**File**: `apps/web/components/SiteFooter.tsx` (new), rendered in `app/layout.tsx` after
`{children}`.
Monochrome, `border-t border-line`, mono uppercase column labels. Columns:
**Explore** (Companies, Investors, Markets, Compare) · **Capbase** (About, FAQ, Contribute) ·
**Compare** (Crunchbase alternative → `/alternatives/crunchbase`, PitchBook alternative →
`/alternatives/pitchbook`) · **Legal** (Terms, Privacy). Bottom line: `© {year} Capbase ·
Data from SEC EDGAR, Wikidata, and community contributions · support@capbase.fyi`.
The keyword-anchored footer links ("Crunchbase alternative") are deliberate internal anchor
text.

#### 3. FAQ page
**File**: `apps/web/app/faq/page.tsx` (new). Static RSC; metadata title
`Frequently Asked Questions`, canonical `/faq`; renders `FAQPage` JSON-LD from the same
content array (single source: `const FAQS: { q: string; a: string }[]` in the file — plain
strings so the JSON-LD needs no JSX stripping).
Questions (final list): What is Capbase? · Is Capbase really free? · Is Capbase an alternative
to Crunchbase or PitchBook? · Where does the data come from? · How accurate is the data? ·
How can I contribute or fix data? · What does "contribute to unlock" mean? · How do I correct
or remove my company's information? (→ support@capbase.fyi) · Can I use Capbase data in my own
project? · Do you have an API? (honest: not yet, roadmap).
Layout: `PageContainer` + `SectionHeader`, one bordered card per Q (`font-display` question,
body answer), matching the ledger aesthetic.

#### 4. About page
**File**: `apps/web/app/about/page.tsx` (new). Metadata title
`About — Open, Crowdsourced Company Data`, canonical `/about`. Sections: mission (open
alternative to closed deal databases), how data flows in (SEC EDGAR Form D ingestion, Wikidata
enrichment, community contributions with admin moderation), the moderation/trust model, the
unlock model, and a contribute CTA. Naturally carries "crowdsourced company data",
"open company database", "free company data".

#### 5. Alternatives comparison pages
**Files**: `apps/web/lib/alternatives.ts` (new content config),
`apps/web/app/alternatives/[competitor]/page.tsx` (new).

Config-driven so more competitors can be added later:

```ts
export type Competitor = {
  slug: 'crunchbase' | 'pitchbook';
  name: string;              // "Crunchbase"
  title: string;             // "Free Crunchbase Alternative"
  h1: string;                // "The free, open Crunchbase alternative"
  intro: string[];
  rows: Array<{ label: string; capbase: string; them: string }>;
  whenToUseThem: string;     // honesty section — good E-E-A-T
  faqs: Array<{ q: string; a: string }>;
};
```

Page: `generateStaticParams` over the config, `generateMetadata` (title/description/canonical),
comparison table (styled like the profile fact panels: `border-line` grid, mono values),
honesty section ("When {name} is still the right tool"), mini-FAQ with `FAQPage` JSON-LD,
CTAs to `/companies` and `/register`. Unknown competitor → `notFound()`.
Comparison rows (generic, non-stale wording — no specific competitor prices): Price
(Free / Paid subscription), Open source (Yes / No), Data sources (SEC EDGAR + Wikidata +
community / Proprietary), Community contributions (Yes, moderated / No), Funding rounds &
investors (Yes / Yes), Account required to browse (No / Yes), Data export (Roadmap / Paid
tiers). Plain nominative use of competitor names, no competitor logos.

#### 6. Homepage copy tweak
**File**: `apps/web/app/page.tsx:29-32` — keep the H1; rework the sub-paragraph to carry
keywords: "Funding rounds, investors, people, and exits for the companies shaping each
sector — a free, crowdsourced alternative to Crunchbase and PitchBook. Open to read, open to
build on."

### Success Criteria:

#### Automated Verification:
- [x] `yarn build` and `yarn lint` pass
- [x] `curl -s localhost:3001/faq | grep -c 'application/ld+json'` ≥ 1; same for both `/alternatives/*` pages
- [x] `curl -s localhost:3001/sitemap.xml` now includes `/faq`, `/about`, both alternatives URLs
- [x] All four new routes return 200; `/alternatives/nonsense` returns 404

#### Manual Verification:
- [ ] Footer renders on every page, monochrome, responsive
- [ ] Paste FAQ + one alternatives URL into Google's Rich Results Test → valid `FAQPage`
- [ ] Comparison pages read as honest and on-brand (no hype, no red)

**Implementation Note**: pause for manual confirmation before Phase 3.

---

## Phase 3: Legal Pages (Terms & Privacy)

### Overview
Draft and ship `/terms` and `/privacy` under the decided identity: individual operator,
Australian governing law, `support@capbase.fyi`.

### Changes Required:

#### 1. Shared legal layout
**File**: `apps/web/app/(legal)/layout.tsx` (new route group) — narrow prose container
(`max-w-[70ch]`), `font-display` h1, styled h2/p/ul via Tailwind utilities (no typography
plugin, no CSS Modules), "Last updated" line in `font-mono`.

#### 2. Terms of Service
**File**: `apps/web/app/(legal)/terms/page.tsx`. Metadata: title `Terms of Service`,
canonical `/terms`, `robots` default (indexable). Content sections:
1. Operator & acceptance — "Capbase (capbase.fyi) is operated by an individual proprietor
   based in Australia ('we/us')." *(If Robert wants their full legal name published, swap in
   at review — flagged in the page as an HTML comment, not a visible placeholder.)*
2. The service — open, crowdsourced company/funding database; free to browse.
3. Accounts — accurate info, credential responsibility, we may suspend for abuse.
4. User contributions — contributor grants a perpetual, worldwide, royalty-free licence to
   host, display, adapt and redistribute the contribution as part of the database; contributor
   warrants they have the right to submit it; moderation may edit/reject/remove anything.
5. Acceptable use — no scraping at abusive rates, no false data, no impersonation, no
   unlawful use.
6. Data disclaimer — data aggregated from public sources (SEC EDGAR, Wikidata) and community
   submissions; provided "as is"; **not** financial, investment, or legal advice; no accuracy
   warranty; corrections via support@capbase.fyi.
7. Third-party content & links — outbound links, Clearbit-served logos, source attributions.
8. Availability — no uptime guarantee; features may change.
9. Liability — limited to the extent permitted by law; **express carve-out for Australian
   Consumer Law guarantees that cannot be excluded**.
10. Termination, changes to terms (notice via site), severability.
11. Governing law — laws of Australia; courts of Australia.
12. Contact — support@capbase.fyi.

#### 3. Privacy Policy
**File**: `apps/web/app/(legal)/privacy/page.tsx`. Metadata: title `Privacy Policy`,
canonical `/privacy`. Framed around the Australian Privacy Principles (APPs). Sections:
1. Who we are + contact (support@capbase.fyi).
2. What we collect — account data (name, email, bcrypt-hashed password), contributions,
   watchlist, server logs (IP, user agent), analytics data.
3. Cookies — `capbase_token` (httpOnly, authentication, essential) and Google Analytics 4
   cookies (`_ga`, `_ga_*`) for usage analytics.
4. Third-party processors — Google Analytics (usage data; link Google's privacy policy & the
   GA opt-out), Resend (transactional email), Clearbit (company logos are fetched by **your
   browser** directly from Clearbit, which sees your IP; company-domain based, not
   user-tracking).
5. How we use data — operating the service, moderation, transactional email, aggregate
   analytics. No selling of personal data.
6. Company data vs personal data — profiles describe companies/public figures from public
   sources; removal/correction requests to support@capbase.fyi.
7. Storage & overseas disclosure — hosting + processors may store data outside Australia
   (e.g., US).
8. Retention, access, correction & deletion — on request via email; account deletion removes
   personal data, contributions may persist de-identified.
9. Complaints — contact us first; unresolved complaints may go to the OAIC.
10. Changes to this policy.

#### 4. Sitemap already lists `/terms` + `/privacy` (Phase 1 §6); footer already links them
(Phase 2 §2). No further wiring.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build` and `yarn lint` pass
- [x] `/terms` and `/privacy` return 200 with correct titles and canonicals

#### Manual Verification:
- [ ] Robert reads both documents end-to-end and confirms the operator description, and
      decides whether to publish their full name
- [ ] GA4 disclosure matches the Phase 5 implementation (cookies named correctly)

**Implementation Note**: legal copy is a template drafted by an AI, not legal advice — the
plan's definition of done for this phase includes the user explicitly signing off on the text.

---

## Phase 4: Structured Data + OG Images

### Overview
JSON-LD on home and company pages; default and per-company social cards via `next/og`.

### Changes Required:

#### 1. Home JSON-LD
**File**: `apps/web/app/page.tsx` — render `<JsonLd>` twice:
- `WebSite` — name, url `SITE_URL`, `potentialAction: SearchAction` targeting
  `${SITE_URL}/companies?q={search_term_string}` (matches the header search form action).
- `Organization` — Capbase itself: name, url, logo `${SITE_URL}/icon.svg`, contact email.

#### 2. Company page JSON-LD
**File**: `apps/web/app/companies/[slug]/page.tsx` — render `<JsonLd>` with:
- `Organization` for the profiled company: `name`, `description` (oneLiner), `url`
  (websiteUrl if present), `foundingDate` (founded year), `address` (hq as
  `PostalAddress.addressLocality` string), `sameAs` (linkedin/twitter URLs when present),
  `logo` (Clearbit URL when `domain` present — same source `CompanyLogo` uses).
- `BreadcrumbList`: Home → Companies → {name}.
Build the objects in a small `lib/schema.ts` helper (pure function, easy to keep out of JSX).

#### 3. Vendored OG fonts
**Files**: `apps/web/assets/fonts/Archivo-Bold.ttf`, `apps/web/assets/fonts/IBMPlexMono-Regular.ttf`
(OFL-licensed; add an `assets/fonts/OFL.txt`). Loaded in OG routes via
`fetch(new URL('../../assets/fonts/Archivo-Bold.ttf', import.meta.url))` so the bundler traces
them into the standalone output — do **not** use `fs` + `process.cwd()` (breaks in the Docker
standalone server).

#### 4. Default OG image
**File**: `apps/web/app/opengraph-image.tsx` (new) — 1200×630 `ImageResponse`: paper
background (`#f6f5f2`-family value **taken from the globals.css ramp**, as literal values are
unavoidable inside ImageResponse), the stepped-corner ink mark, "Capbase" in Archivo bold,
tagline + `capbase.fyi` meta line in Plex Mono. Export `alt`, `size`, `contentType`.

#### 5. Per-company OG image
**File**: `apps/web/app/companies/[slug]/opengraph-image.tsx` (new) — fetches via the
`cache()`-wrapped `getCompanyDetail`; renders company name (Archivo), one-liner, and a mono
stat row (Total raised · Stage · Founded) with a thin ladder-bar motif. Unknown slug → default
branding (never throw). The route inherits the 60s ISR via `apiFetch`.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build` and `yarn lint` pass
- [x] `curl -s -o /dev/null -w '%{content_type}' localhost:3001/opengraph-image` → `image/png`
- [x] Same for `localhost:3001/companies/<seeded-slug>/opengraph-image` (and unknown slug → 200 default card)
- [x] Company page source includes `og:image` pointing at the per-company route and two
      `application/ld+json` blocks

#### Manual Verification:
- [ ] Rich Results Test on a company URL: valid Organization + BreadcrumbList
- [ ] opengraph.xyz (or Slack/X paste) preview of `/` and one company page looks right
- [ ] Cards are legible, monochrome, fonts render (not fallback serif)

**Implementation Note**: pause for manual confirmation before Phase 5.

---

## Phase 5: Analytics + Go-Live Polish

### Overview
GA4 wiring, demo-disclaimer removal, env/deploy wiring, and the post-deploy search checklist.

### Changes Required:

#### 1. GA4
**Files**: `apps/web/package.json` (+`@next/third-parties`), `apps/web/app/layout.tsx`:

```tsx
const gaId = process.env.NEXT_PUBLIC_GA_ID; // read server-side at runtime; no build arg needed
...
<body ...>
  <SiteHeader />
  {children}
  <SiteFooter />
  {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
</body>
```

Add `NEXT_PUBLIC_GA_ID` to `.env.example` and the `web` service in `docker-compose.yml`
(runtime env — verify at implementation that the standalone server picks it up per the note
above; it's read in an RSC, not a client bundle).

#### 2. Remove demo-data disclaimer
**File**: `apps/web/app/companies/[slug]/page.tsx:316-318` — replace the footer text with a
sourcing line: "Data aggregated from SEC EDGAR, Wikidata, and community contributions.
Spotted an error? Propose a change." (link to the contribute flow).

#### 3. Deploy wiring
- `docker-compose.yml`: `SITE_URL=https://capbase.fyi`, `NEXT_PUBLIC_GA_ID=${NEXT_PUBLIC_GA_ID:-}`
  on the `web` service.
- Confirm `apps/web/Dockerfile` copies `assets/` (needed if font tracing pulls from there —
  verify the standalone build includes the fonts by hitting the OG route in the container).

#### 4. Post-deploy checklist (manual, documented in this plan as the go-live runbook)
1. Create the GA4 property → set `NEXT_PUBLIC_GA_ID`.
2. Google Search Console: verify `capbase.fyi` (DNS TXT), submit `https://capbase.fyi/sitemap.xml`.
3. Request indexing for `/`, `/alternatives/crunchbase`, `/alternatives/pitchbook`, `/faq`, `/about`.
4. Re-run Rich Results Test against production URLs.
5. Set up `support@capbase.fyi` forwarding **before** the legal pages go live.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build` and `yarn lint` pass
- [x] With `NEXT_PUBLIC_GA_ID=G-TEST` set, page source includes the gtag script; without it, no GA script
      (verified against the standalone server — runtime env read confirmed, no build arg)
- [x] `make up` boots the full stack; `curl -s localhost:3001/sitemap.xml` and both OG image routes work inside Docker
      (sitemap serves the build-time prerender on first hit, full 11k company URLs after 60s ISR revalidation;
      OG fonts render correctly from the standalone output)

#### Manual Verification:
- [ ] GA4 realtime shows a visit after deploy
- [ ] Search Console accepts the sitemap without errors
- [ ] Demo disclaimer gone from company profiles; sourcing line reads well

---

## Testing Strategy

### Unit Tests:
- `apps/api`: `companies.service.spec.ts` — `listSlugs` filters to APPROVED, ISO-formats
  dates; controller spec (or e2e-style route check) that `/companies/sitemap` doesn't get
  captured by `:slug`.
- No test infra exists in `apps/web`; verification there is build + lint + curl assertions
  (consistent with the repo's current practice).

### Integration Tests:
- Full-stack curl pass (api + web + db running): robots, sitemap, one company page metadata,
  JSON-LD counts, OG image content types — scripted as the automated criteria above.

### Manual Testing Steps:
1. Rich Results Test: `/faq`, one `/alternatives/*`, one `/companies/[slug]`.
2. Social-card preview for `/` and a company page.
3. Read-through of Terms/Privacy by the user (sign-off required).
4. Lighthouse SEO audit on `/`, `/companies/[slug]`, `/alternatives/crunchbase` — target ≥ 95.

## Performance Considerations

- Sitemap fetch is one indexed Prisma select; cached 60s by `apiFetch` ISR defaults.
- `cache()` around `getCompanyDetail` prevents triple-fetch (metadata + page + OG image).
- OG images render on demand and cache via ISR; fonts are bundled, no network fetch at runtime.
- GA4 via `@next/third-parties` loads after hydration; no render blocking.

## Migration Notes

- No DB migrations. One additive API endpoint (backwards compatible).
- Sitemap references Phase 2–3 URLs; deploy Phases 1–3 together (planned) or gate those
  entries if shipping Phase 1 alone.

## References

- Root metadata today: `apps/web/app/layout.tsx:25`
- Company page (metadata target + disclaimer): `apps/web/app/companies/[slug]/page.tsx:19,316`
- Sector params precedent: `apps/web/app/markets/[sector]/page.tsx:19`
- API companies controller (route-order constraint): `apps/api/src/companies/companies.controller.ts:26-32`
- Data seam + ISR: `apps/web/lib/api.ts:21`, `apps/web/lib/data.ts:398`
- Sector slug helpers: `apps/web/lib/markets.ts`
- Prior plan style: `thoughts/shared/plans/2026-07-18-server-side-directories-and-real-markets.md`
