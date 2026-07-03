# Browse Pages (Companies / Investors / Markets) + Filtering & Search — Implementation Plan

## Overview

Turn the three primary nav links (Companies, Investors, Markets) — which all currently
point at `/` — into real, dedicated pages, each with search, filtering, and sorting. The
landing page keeps its role as a curated overview and starts linking *into* these pages
instead of being the only page.

## Current State Analysis

- **Nav is dead-ended.** `components/SiteHeader.tsx:24-32` — all three links `href="/"`. The
  header search form (`SiteHeader.tsx:35-50`) submits `q` to `action="/"`, but `app/page.tsx`
  never reads `q`. Nothing is filterable anywhere.
- **Routes today:** only `/` (`app/page.tsx`) and `/companies/[slug]` exist. No `/companies`
  index, no `/investors`, no `/markets`.
- **Data seam:** `getCompanies()` (`lib/data.ts:321`) returns *all* approved companies, no
  args, backed by `GET /companies` → `CompaniesService.findAllApproved()` (`companies.service.ts:53`),
  which has no query params. `getMarketStats()` / `getMarketTotals()` back the sector tape.
- **Companies carry filter-ready controlled vocabularies:** `primarySector` (`Sector`, 5 values),
  `stage` (`Stage`), `status` (`CompanyStatus`) — all in `packages/api/src/domain/company.ts`.
- **Investors are NOT a first-class entity.** They exist only as `InvestorHolding` rows embedded
  per-company (`domain/company.ts:98`, Prisma model `schema.prisma:130`), and that data is
  returned *only* by the gated detail endpoint. There is no investor list anywhere. `InvestorHolding`
  has a `company` relation (`schema.prisma:133`) and fields `name, type, firstRound, rounds`.
- **Design system** (per `CLAUDE.md`): monochrome; build from `components/ui` primitives
  (`Select`, `Input`, `Badge`, `Button`, `SectionHeader`, `EmptyState`, `PageContainer`, `Stat`),
  Tailwind utilities, `lib/format.ts` for all numbers. No accent color, no CSS modules.

## Desired End State

- `/companies` — full directory with live search (name/one-liner) + Sector/Stage/Status filters
  + sort (name, total raised, last valuation), result count, filter state mirrored to the URL
  (`?q=&sector=&stage=&status=&sort=`) so links are shareable and the header search deep-links here.
- `/investors` — directory of unique investors aggregated from approved `InvestorHolding` rows,
  with search + Type filter + sort (portfolio size), backed by a new `GET /investors` endpoint.
- `/markets` — sortable sector table (capital, deals, median valuation, trend, # companies) with
  totals; each row links to `/markets/[sector]`.
- `/markets/[sector]` — sector detail: the sector's stat block + the companies in that sector
  (reusing the company table).
- `SiteHeader` nav points at the three real routes; header search posts to `/companies?q=`.
- Landing page keeps hero + tape + a *preview* of companies, but every entry point links into
  the new pages ("Browse companies" → `/companies`, tape cards → `/markets/[sector]`, "View all").

**Verification:** clicking each nav item lands on its own page; typing in a filter narrows results
instantly and updates the URL; reloading a filtered URL restores the same view; `/markets/[sector]`
shows only that sector's companies.

### Key Discoveries
- Client-side filtering is viable and simplest: the company set is small and already fully fetched
  with 60s ISR (`lib/api.ts:26`). No new company query params needed.
- The investor aggregate is a pure read over existing approved data — **no schema/migration** —
  because `InvestorHolding` already relates to `Company` (`schema.prisma:133`).
- `Select` is Radix (`components/ui/select.tsx`), driven by `onValueChange`; usable directly in a
  client filter bar (it does not require react-hook-form — RHF is only for the contribute forms).
- Sector values contain spaces (`"Artificial intelligence"`), so `/markets/[sector]` needs a
  slug<->label map, not raw values in the path.

## What We're NOT Doing

- No new Prisma models / migrations. Investors stay derived from `InvestorHolding`; `MarketStat`
  aggregates stay seeded (per `CLAUDE.md`), not recomputed from companies.
- No investor **detail** pages (`/investors/[id]`) — only the list. (Markets is the only section
  getting drill-down, per decision.)
- No server-side company filtering / pagination / query params on `GET /companies`.
- No changes to the contribution/moderation flow, auth, or the gated company-detail endpoint.
- No global full-text search page; header search deep-links into `/companies`.

## Implementation Approach

Bottom-up: (1) add the investor read API + shared type; (2) extend the web data seam and extract a
reusable company table; (3–5) build the three page groups with URL-driven client filters; (6) wire
nav, search, and landing links. Each page is a **server component** that fetches + reads
`searchParams`, handing data and initial filter state to a small **client** filter component that
owns interaction and URL sync.

---

## Phase 1: Investor aggregate API + shared type

### Overview
Expose a unique-investor list derived from approved `InvestorHolding` rows on approved companies.

### Changes Required

#### 1. Shared type (`@repo/api`)
**File**: `packages/api/src/domain/investor.ts` (new), re-exported from `packages/api/src/entry.ts`
```ts
import type { InvestorType } from './company';

export interface InvestorSummary {
  /** Canonical investor name (grouping key). */
  name: string;
  /** Most-frequent type across this investor's holdings. */
  type: InvestorType;
  /** Number of distinct approved companies this investor backs. */
  portfolioCount: number;
  /** Distinct sectors across the portfolio (may include none if unset). */
  sectors: string[];
  /** Small sample for the row's portfolio preview. */
  companies: { slug: string; name: string; domain: string }[];
}
```
Add `export * from './domain/investor';` to `entry.ts` (match existing barrel style).

#### 2. Investors module (`apps/api`)
**Files**: `apps/api/src/investors/{investors.module.ts,investors.controller.ts,investors.service.ts}`
(new); register `InvestorsModule` in `apps/api/src/app.module.ts`.
```ts
// investors.service.ts — aggregate in JS after a single relational read
async findAll(): Promise<InvestorSummary[]> {
  const holdings = await this.prisma.investorHolding.findMany({
    where: { moderationStatus: 'APPROVED', company: { moderationStatus: 'APPROVED' } },
    include: { company: { select: { slug: true, name: true, domain: true, primarySector: true } } },
  });
  // group by holding.name -> { types[], companies map, sectors set }, then reduce:
  //   type = mode(types); portfolioCount = distinct company slugs;
  //   sectors = distinct non-null primarySector; companies = first N (e.g. 6) by name.
  // sort by portfolioCount desc, then name asc.
}
```
```ts
// investors.controller.ts
@Controller('investors')
export class InvestorsController {
  constructor(private readonly investors: InvestorsService) {}
  @Get() findAll(): Promise<InvestorSummary[]> { return this.investors.findAll(); }
}
```

#### 3. Unit test
**File**: `apps/api/src/investors/investors.service.spec.ts` (new) — mock `prisma.investorHolding.findMany`
returning holdings for the same investor across two companies; assert dedupe (`portfolioCount === 2`),
type mode, and portfolio-desc ordering. Model it on `companies.service.spec.ts`.

### Success Criteria

#### Automated Verification
- [x] Packages build: `yarn build`
- [x] API unit tests pass: `yarn workspace api test`
- [x] Lint passes: `yarn lint`
- [ ] `GET /investors` returns a JSON array: `curl -s localhost:3000/investors | head`

#### Manual Verification
- [ ] Response contains unique investors with sane `portfolioCount` and a `companies` sample.
- [ ] An investor appearing in multiple companies shows once, count > 1.

**Implementation Note**: pause for manual confirmation before Phase 2.

---

## Phase 2: Web data seam + reusable company table

### Overview
Add the investor getter and a sector slug helper; extract the landing page's inline company table
into a shared presentational component so `/companies`, `/markets/[sector]`, and `/` all reuse it.

### Changes Required

#### 1. `getInvestors()` (`apps/web/lib/data.ts`)
Add `import type { InvestorSummary } from '@repo/api'`, re-export it, and:
```ts
const fallbackInvestors: InvestorSummary[] = [/* small illustrative list */];
export async function getInvestors(): Promise<InvestorSummary[]> {
  try { return await apiFetch<InvestorSummary[]>('/investors'); }
  catch (err) { console.warn('[data] getInvestors fell back to mock data:', err); return fallbackInvestors; }
}
```

#### 2. Sector slug helper (`apps/web/lib/markets.ts`, new)
```ts
import { SECTORS, type Sector } from '@repo/api';
export const sectorSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const sectorFromSlug = (slug: string): Sector | undefined =>
  SECTORS.find((s) => sectorSlug(s) === slug);
```

#### 3. Extract `CompanyTable` (`apps/web/components/CompanyTable.tsx`, new)
Move the `role="table"` markup + rows from `app/page.tsx:72-130` verbatim into a presentational
component `function CompanyTable({ companies }: { companies: Company[] })`. No behavior change; keep
the exact Tailwind classes and `CompanyLogo`/`Badge`/`formatUsd` usage. Landing page then renders
`<CompanyTable companies={preview} />`.

### Success Criteria
#### Automated Verification
- [x] Build passes: `yarn build`
- [x] Lint passes: `yarn lint`
#### Manual Verification
- [ ] Landing page company table looks identical to before the extraction.

---

## Phase 3: `/companies` directory with URL-driven filters

### Overview
Dedicated companies page: server fetches all approved companies + reads `searchParams`; a client
filter bar owns search/filter/sort and mirrors state to the URL.

### Changes Required

#### 1. Page (`apps/web/app/companies/page.tsx`, new — server component)
```tsx
export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string,string|undefined>> }) {
  const [companies, sp] = await Promise.all([getCompanies(), searchParams]);
  return (
    <PageContainer as="main" className="pt-14">
      <SectionHeader title="Companies" note={`${companies.length} profiles`} />
      <CompanyDirectory companies={companies} initial={sp} />
    </PageContainer>
  );
}
```

#### 2. Client filter (`apps/web/app/companies/CompanyDirectory.tsx`, new — `'use client'`)
- Local state seeded from `initial` (`q`, `sector`, `stage`, `status`, `sort`).
- Filter bar: `Input` (search, debounced) + three `Select`s (Sector from `SECTORS`, Stage from
  `STAGES`, Status from `COMPANY_STATUSES`, each with an "All" option) + a sort `Select`
  (Name / Total raised / Last valuation). Result count + a "Clear" `Button variant="ghost"` when
  any filter is active.
- Derive filtered+sorted list with `useMemo`; case-insensitive substring match on `name` +
  `oneLiner`; render `<CompanyTable companies={filtered} />`, or `<EmptyState>` when empty.
- Sync to URL with `useRouter().replace(`?${params}`, { scroll: false })` via
  `usePathname`/`useSearchParams`; drop empty/`all` keys so clean URLs stay clean.

### Success Criteria
#### Automated Verification
- [x] Build passes: `yarn build`
- [x] Lint passes: `yarn lint`
#### Manual Verification
- [ ] Typing narrows the table live; selecting a sector/stage/status filters correctly.
- [ ] URL updates (`?q=&sector=…`); reloading that URL restores the same filtered view.
- [ ] Sort options reorder rows; "Clear" resets and empties the query string.
- [ ] Empty result shows the `EmptyState`, not a blank table.

**Implementation Note**: pause for manual confirmation before Phase 4.

---

## Phase 4: `/investors` directory

### Overview
Investor list page mirroring the companies pattern, over `getInvestors()`.

### Changes Required

#### 1. Page (`apps/web/app/investors/page.tsx`, new — server component)
Fetch `getInvestors()`, read `searchParams`, render `<SectionHeader title="Investors" …/>` +
`<InvestorDirectory investors={…} initial={sp} />` inside `PageContainer`.

#### 2. Client filter + table (`apps/web/app/investors/InvestorDirectory.tsx`, new — `'use client'`)
- Filter bar: `Input` search (investor name) + `Select` Type (`INVESTOR_TYPES` + "All") + sort
  (Portfolio size / Name). URL-synced like Phase 3.
- Table columns: Investor (name + `Badge` type), Portfolio count (mono), sectors (comma list or
  small badges), portfolio preview (company names from `companies`). Reuse `formatCount`.
- `EmptyState` on no matches.

### Success Criteria
#### Automated Verification
- [x] Build passes: `yarn build`
- [x] Lint passes: `yarn lint`
#### Manual Verification
- [ ] `/investors` lists unique investors; search + Type filter + sort work and update the URL.
- [ ] With the API down, the page still renders from the fallback list.

**Implementation Note**: pause for manual confirmation before Phase 5.

---

## Phase 5: `/markets` overview + `/markets/[sector]` drill-down

### Overview
A sortable sector table with totals, each row drilling into a sector page listing its companies.

### Changes Required

#### 1. Overview page (`apps/web/app/markets/page.tsx`, new — server component)
- Fetch `getMarketStats()`, `getMarketTotals()`, `getCompanies()` in parallel; compute a
  `companiesBySector` count map (companies whose `primarySector === stat.sector`).
- Render the totals `Stat` row (reuse the block from `app/page.tsx:37-44`) + `<MarketTable>`.

#### 2. Client table (`apps/web/app/markets/MarketTable.tsx`, new — `'use client'`)
- Columns: Sector (links to `/markets/${sectorSlug(sector)}`), Capital (`formatUsd`), Deals
  (`formatCount`), Median valuation (`formatUsd`), Trend (`signedPct`, monochrome per design),
  # Companies. Header cells toggle sort asc/desc; default capital desc. Optional URL `?sort=`.

#### 3. Sector detail (`apps/web/app/markets/[sector]/page.tsx`, new — server component)
```tsx
const sector = sectorFromSlug((await params).sector);
if (!sector) notFound();
const [stats, companies] = await Promise.all([getMarketStats(), getCompanies()]);
const stat = stats.find((s) => s.sector === sector);
const inSector = companies.filter((c) => c.primarySector === sector);
// render Eyebrow(sector) + stat block (deals / capital / median) + <CompanyTable companies={inSector}/>
// EmptyState when inSector is empty ("No companies yet — contribute one").
```
Add `export function generateStaticParams()` returning `SECTORS.map((s) => ({ sector: sectorSlug(s) }))`.

### Success Criteria
#### Automated Verification
- [x] Build passes: `yarn build`
- [x] Lint passes: `yarn lint`
- [ ] Unknown sector 404s: `curl -s -o /dev/null -w "%{http_code}" localhost:3001/markets/not-a-sector` → `404`
#### Manual Verification
- [ ] `/markets` table sorts by each column; totals render.
- [ ] Clicking a sector opens `/markets/[sector]` with only that sector's companies + its stats.
- [ ] A sector with no companies shows the contribute `EmptyState`.

**Implementation Note**: pause for manual confirmation before Phase 6.

---

## Phase 6: Wire navigation, header search, and landing links

### Overview
Point the nav and search at the real routes and make the landing page an overview that links out.

### Changes Required

#### 1. `components/SiteHeader.tsx`
- Links: Companies → `/companies`, Investors → `/investors`, Markets → `/markets` (lines 24-32).
- Search form `action="/companies"` (line 38); keep `name="q"` so it deep-links into the directory.

#### 2. `app/page.tsx`
- Hero "Browse companies" button → `/companies` (currently `#companies`, line 28).
- Sector tape cards (lines 50-65): wrap each in `Link href={`/markets/${sectorSlug(stat.sector)}`}`.
- "Companies" section: show a preview (e.g. first 8) via `<CompanyTable companies={companies.slice(0,8)}/>`
  with a "View all companies →" `Button variant="ghost" href="/companies"` in the `SectionHeader` note area.

### Success Criteria
#### Automated Verification
- [x] Build passes: `yarn build`
- [x] Lint passes: `yarn lint`
#### Manual Verification
- [ ] Each nav link routes to its own page (no more everything-on-`/`).
- [ ] Header search from any page lands on `/companies` pre-filtered by the typed query.
- [ ] Landing tape cards navigate to the matching sector page; "View all" reaches `/companies`.

---

## Testing Strategy

### Unit Tests
- `investors.service.spec.ts`: dedupe across companies, type mode, portfolio-desc ordering,
  and exclusion of non-approved holdings/companies.

### Manual Testing Steps
1. `make dev` (API :3000, web :3001). Visit `/`, click each nav item — confirm three distinct pages.
2. On `/companies`: search, apply each filter, sort, copy the URL, open in a new tab — same view.
3. On `/investors`: confirm unique investors and working Type filter/sort.
4. On `/markets`: sort columns, drill into a sector, verify company list matches the sector.
5. Stop the API; reload each page — fallbacks render (companies/investors/market).

## Performance Considerations
- Client filtering over the current small dataset is instant; if company count grows large later,
  revisit server-side query params on `GET /companies` (explicitly deferred here).
- `/investors` does one relational read + in-memory group — fine at this scale; it benefits from the
  same 60s ISR as other public reads.

## References
- Nav/search: `apps/web/components/SiteHeader.tsx:24-50`
- Landing (source of extracted table): `apps/web/app/page.tsx:37-130`
- Data seam: `apps/web/lib/data.ts:321-381`, `apps/web/lib/api.ts`
- Companies API: `apps/api/src/companies/companies.{controller,service}.ts`
- Investor source data: `packages/db/prisma/schema.prisma:130-149`, `apps/api/src/companies/company.mapper.ts:70-79`
- Vocabularies: `packages/api/src/domain/company.ts` (`SECTORS`, `STAGES`, `COMPANY_STATUSES`, `INVESTOR_TYPES`)
- UI primitives: `apps/web/components/ui/index.ts`
