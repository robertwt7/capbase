# Server-Side Directories & Real Markets Implementation Plan

## Overview

Three connected problems, one plan:

1. **Markets are fake.** `MarketStat` / `MarketSnapshot` are seeded demo tables — deal
   counts, capital, median valuation, and trend on `/markets` have no relationship to the
   11,055 real companies in the DB. Replace them with live SQL aggregates computed from
   `Company` + `FundingRound`.
2. **Only 5 markets, 90% of companies sectorless.** `SECTORS` is a hardcoded 5-value
   vocabulary and 9,992 of 11,055 companies have `primarySector = NULL` because SEC
   ingestion never maps the Form D `industryGroupType` (already stored in `industry[]`)
   to a sector. Expand the vocabulary to 14 sectors, map at ingest time, and backfill.
3. **No pagination, frontend-only filtering.** `GET /companies` returns all 11k rows;
   `CompanyDirectory` / `InvestorDirectory` filter in a client `useMemo`. Move search,
   filters, sort, and pagination server-side (URL-driven, numbered pages).

## Current State Analysis

- `apps/api/src/companies/companies.service.ts:62` — `findAllApproved()` returns every
  approved company, no filters/pagination. DB currently holds **11,055 approved
  companies, 6,726 investor holdings, 5,286 rounds, 771 unique investors**.
- `apps/web/app/companies/page.tsx:10` ships the full list to the client;
  `apps/web/app/companies/CompanyDirectory.tsx:96-117` filters/sorts in `useMemo`.
  URL params (`?q=&sector=…`) are only *mirrored* for shareability, never sent to the API.
- `apps/web/app/page.tsx:12` (landing) fetches all 11k to render 8 rows.
- `apps/api/src/investors/investors.service.ts:39` loads all 6,726 holdings into memory
  and aggregates per request; `InvestorDirectory.tsx:58` filters client-side.
- `packages/db/prisma/schema.prisma:286-302` — `MarketStat` ("seeded, not
  user-contributed") + `MarketSnapshot` singleton; seeded in
  `packages/db/prisma/seed.ts:228,369-386`.
- `apps/web/app/markets/page.tsx:13-23` computes only `companyCount` from real data —
  by fetching **all** companies and counting in JS.
- `packages/api/src/domain/company.ts:35-48` — `Sector`/`SECTORS`, 5 values.
- Sector distribution today: NULL 9,992 · Climate 750 · Healthcare 179 ·
  Enterprise SaaS 65 · Fintech 40 · AI 29.
- SEC Form D taxonomy is already captured: `form-d.parser.ts:48` extracts
  `industryGroupType` into `Company.industry[]` (32 distinct values in DB, e.g.
  "Other Technology" ×941, "Biotechnology" ×180, "Oil and Gas" ×105). The normalized
  record type already has a `primarySector` slot (`ingestion-source.ts:66`) and
  `ingest.service.ts:253,288` already persists + enriches it — only the SEC source never
  sets it.
- `wikidata.mapper.ts:25-38` — small regex mapper (`sectorFor`) to the 5 sectors.
- `apps/web/components/SiteHeader.tsx` search deep-links to `/companies?q=…` — works
  unchanged once filtering is server-side.
- `apps/web/app/compare/page.tsx:37` fetches **all** companies to resolve ≤4 slugs and
  to build a `<Select>` with 11k options (`ComparePicker.tsx`).

## Desired End State

- `/markets` lists every sector that has ≥1 approved company (~14 markets), with deal
  count, capital, median valuation, trend, and company count all computed from real rows.
- `>90%` of SEC-ingested companies have a `primarySector`; new ingests map automatically.
- `GET /companies` and `GET /investors` accept `q/filter/sort/page/pageSize` and return
  `{ items, total, page, pageSize }`. Directory pages are URL-driven with numbered
  pagination; changing a filter round-trips to the server.
- No page ever fetches the full company list.

### Key Discoveries:
- Form D's industry taxonomy is fixed and fully enumerable → a deterministic
  `industryGroupType → Sector` map is possible (no heuristics needed for SEC rows).
- `ingest.service.ts:288` already fills blank `primarySector` on enrichment, so ingest-time
  mapping needs zero ingest-service changes.
- `MarketStat.sector` is typed `string` in `@repo/api` (`domain/market.ts:2`), so
  expanding sectors is not a breaking type change for market consumers.
- Prisma `groupBy` supports `orderBy: { _count }` + `skip/take` → investor pagination can
  be done without raw SQL; only the sector-median needs `$queryRaw` (`percentile_cont`).

## What We're NOT Doing

- No investor detail pages (`/investors/[name]`) — directory only.
- No renaming/merging of the existing 5 sectors (data compat: keep their exact strings).
- No infinite scroll / load-more; numbered pages only.
- No pg_trgm / full-text search — `ILIKE '%q%'` (Prisma `contains, mode: 'insensitive'`)
  is fine at this scale.
- No sector re-classification of rows that already have a `primarySector` (backfill only
  fills NULLs; never overwrites).
- Not touching the gated company-detail endpoint, contribution flow, or admin portal.
- `MarketStat`/`MarketTotals` computation stays in the API (no jobs cron materialization).

## Implementation Approach

Four phases, each independently shippable. Sectors first (markets math depends on
coverage), then real market stats, then companies pagination, then investors.

Conventions used throughout:
- New shared types live in `@repo/api` (`packages/api/src/domain/`), exported from the
  existing barrels.
- All list endpoints return `Paginated<T>`; page size defaults to 25, capped at 100.
- Web filter components keep the existing "mirror state → URL via debounced
  `router.replace`" pattern (`CompanyDirectory.tsx:82-94`) — but the server component
  re-reads `searchParams` and refetches, so the URL becomes the single source of truth.

---

## Phase 1: Expand Sector Vocabulary + Ingest Mapping + Backfill

### Overview
Grow `SECTORS` from 5 → 14, add a deterministic SEC Form D → Sector map, extend the
Wikidata regex rules, and backfill `primarySector` for existing rows from their stored
`industry[]` values.

### Changes Required:

#### 1. Expand the vocabulary
**File**: `packages/api/src/domain/company.ts`
**Changes**: extend `Sector` union + `SECTORS` array. Keep the existing 5 strings
verbatim; append 9:

```ts
export type Sector =
  | 'Artificial intelligence'
  | 'Fintech'
  | 'Healthcare'
  | 'Climate'
  | 'Enterprise SaaS'
  | 'Technology'          // generic tech (SEC "Other Technology"/"Computers")
  | 'Financial services'  // banking, insurance, investing
  | 'Energy'              // oil & gas, non-renewable energy
  | 'Real estate'
  | 'Industrials'         // manufacturing, agriculture, construction inputs
  | 'Consumer & retail'   // retail, restaurants, hospitality, travel
  | 'Transport'
  | 'Media & telecom'
  | 'Education';
```

No DTO changes needed — `primarySector` is validated with `@IsIn(SECTORS)` which picks
up the new values, and the contribute form's `SelectField` iterates `SECTORS`.

#### 2. Deterministic SEC map, applied at ingest
**New file**: `apps/jobs/src/sources/sec-edgar/sector-map.ts`
**Changes**: exact-match record covering all 32 Form D `industryGroupType` values →
`Sector | null` (null = leave unclassified):

```ts
export const SEC_SECTOR_MAP: Readonly<Record<string, Sector | null>> = {
  'Agriculture': 'Industrials',
  'Airlines and Airports': 'Transport',
  'Biotechnology': 'Healthcare',
  'Business Services': null,
  'Commercial': 'Real estate',
  'Commercial Banking': 'Financial services',
  'Computers': 'Technology',
  'Construction': 'Real estate',
  'Energy Conservation': 'Climate',
  'Electric Utilities': 'Energy',
  'Environmental Services': 'Climate',
  'Coal Mining': 'Energy',
  'Health Insurance': 'Healthcare',
  'Hospitals and Physicians': 'Healthcare',
  'Insurance': 'Financial services',
  'Investing': 'Financial services',
  'Investment Banking': 'Financial services',
  'Lodging and Conventions': 'Consumer & retail',
  'Manufacturing': 'Industrials',
  'Oil and Gas': 'Energy',
  'Other': null,
  'Other Banking and Financial Services': 'Financial services',
  'Other Energy': 'Energy',
  'Other Health Care': 'Healthcare',
  'Other Real Estate': 'Real estate',
  'Other Technology': 'Technology',
  'Other Travel': 'Consumer & retail',
  'Pharmaceuticals': 'Healthcare',
  'Pooled Investment Fund': 'Financial services',
  'REITS and Finance': 'Real estate',
  'Residential': 'Real estate',
  'Restaurants': 'Consumer & retail',
  'Retailing': 'Consumer & retail',
  'Telecommunications': 'Media & telecom',
  'Tourism and Travel Services': 'Consumer & retail',
};
export const secSector = (industry: string): Sector | null =>
  SEC_SECTOR_MAP[industry] ?? null;
```

**File**: `apps/jobs/src/sources/sec-edgar/sec-edgar.source.ts` (~line 92)
**Changes**: set `primarySector: parsed.industry ? secSector(parsed.industry) : null` on
the normalized company. Nothing else — `ingest.service.ts:253,288` already persists it
and fills blanks on enrichment.

#### 3. Extend Wikidata rules
**File**: `apps/jobs/src/sources/wikidata/wikidata.mapper.ts:25-31`
**Changes**: extend `SECTOR_RULES` for the new sectors. **Ordering matters** (first match
wins): specific fintech terms must stay above the broad financial rule; renewables above
generic energy.

```ts
const SECTOR_RULES: readonly [RegExp, Sector][] = [
  [/artificial intelligence|machine learning/i, 'Artificial intelligence'],
  [/fintech|payment/i, 'Fintech'],
  [/bank|insurance|invest|financial|credit|asset management/i, 'Financial services'],
  [/health|biotech|pharma|medical|hospital/i, 'Healthcare'],
  [/climate|solar|wind power|renewable|carbon|environmental/i, 'Climate'],
  [/oil|gas|petroleum|energy|utilit|sewer|water supply/i, 'Energy'],
  [/software|saas|cloud/i, 'Enterprise SaaS'],
  [/real estate|property|housing|construction|urban planning/i, 'Real estate'],
  [/transport|logistic|airline|railway|shipping|automotive/i, 'Transport'],
  [/retail|restaurant|hotel|tourism|travel|consumer|food/i, 'Consumer & retail'],
  [/telecommunication|media|broadcast|publishing|entertainment/i, 'Media & telecom'],
  [/education|university|school/i, 'Education'],
  [/manufactur|industrial|agricult|forestry|mining|chemical/i, 'Industrials'],
  [/technology|computer|internet|electronics/i, 'Technology'],
];
```

#### 4. Backfill command
**New file**: `apps/jobs/src/backfill-sectors.ts` (mirror `backfill.ts` entry pattern)
**Changes**: one-off CLI `node dist/backfill-sectors.js`. For every company with
`primarySector: null` and non-empty `industry`, try `secSector(industry[0])` when
`externalSource === 'SEC_EDGAR'`, else `sectorFor(industry.join(' '))` (Wikidata regex,
also the fallback for human rows). Update matched rows; log
`updated/scanned` counts. Never overwrite non-null sectors.

**File**: `Makefile`
**Changes**: add target next to `ingest` (line 75):

```make
.PHONY: backfill-sectors
backfill-sectors: ## Fill missing Company.primarySector from stored industry values
	cd apps/jobs && node dist/backfill-sectors.js
```

#### 5. Unit tests
**Files**: `apps/jobs/src/sources/sec-edgar/sector-map.spec.ts` (every SEC value maps;
unknown → null), extend `wikidata.mapper.spec.ts` (rule ordering: "investment bank" →
Financial services, "payment platform" → Fintech, "solar energy" → Climate not Energy).

### Success Criteria:

#### Automated Verification:
- [x] `yarn build` passes (turbo, all workspaces)
- [x] `yarn lint` passes (`--max-warnings 0`)
- [x] `yarn workspace jobs test` passes (new mapper specs included — 93 tests, 6 suites)
- [x] Backfill runs: `make backfill-sectors` exits 0 and logs updated counts
      (7,921 sectors filled across 9,589 scanned)
- [x] Coverage check: `SELECT count(*) FROM "Company" WHERE "primarySector" IS NULL`
      drops from ~9,992 to < 3,000 (rows with mappable industries get classified;
      "Other"/"Business Services"/blank-industry rows legitimately stay null)
      — landed at 2,071 nulls; all 14 sectors populated

#### Manual Verification:
- [ ] Contribute form's sector dropdown shows all 14 sectors
- [ ] Spot-check 5 backfilled companies: sector is sensible for their industry value
- [ ] A fresh `make ingest DAYS=3 SOURCE=SEC_EDGAR` produces new rows with sectors set

**Implementation Note**: pause here for manual confirmation before Phase 2.

---

## Phase 2: Real Market Stats (Computed in SQL)

### Overview
Delete the seeded `MarketStat`/`MarketSnapshot` tables; `MarketService` computes stats
from `Company` + `FundingRound`. The `/markets` pages stop fetching the full company list.

### Definitions (locked):
- **Per sector** (only sectors with ≥1 approved company):
  - `companyCount` — approved companies with that `primarySector`
  - `dealCount` — APPROVED rounds belonging to approved companies in the sector
  - `totalRaisedUsd` — `SUM(Company.totalRaisedUsd)` over approved companies (covers
    companies that have totals but no round rows)
  - `medianValuationUsd` — `percentile_cont(0.5)` over non-null `Company.lastValuationUsd`;
    `0` when no company in the sector has a valuation
  - `trendPct` — round-count change, trailing 90 days vs the 90 days before
    (`(cur - prev) / prev * 100`, `0` when `prev = 0`)
- **Totals**: `totalRaisedUsd` + `dealCount` all-time over approved rows; `newUnicorns` →
  count of approved companies with `lastValuationUsd ≥ $1B` (frontend label changes
  "New unicorns" → "Unicorns"); `quarter` — current calendar quarter from `new Date()`
  (e.g. `"Q3 2026"`).

### Changes Required:

#### 1. Shared type gains companyCount
**File**: `packages/api/src/domain/market.ts`
**Changes**: add `companyCount: number` to `MarketStat`. (The web's `MarketRow` in
`MarketTable.tsx:11` already wants it — it can then be `type MarketRow = MarketStat`.)

#### 2. Compute in the API
**File**: `apps/api/src/market/market.service.ts` (rewrite)
**Changes**: replace both table reads:
- `getStats()` — one `$queryRaw` grouping approved companies by `primarySector`
  (`WHERE "primarySector" IS NOT NULL AND "moderationStatus" = 'APPROVED'`) computing
  `companyCount`, `SUM(totalRaisedUsd)`, `percentile_cont(0.5) WITHIN GROUP (ORDER BY
  "lastValuationUsd")`; a second grouped query over `FundingRound JOIN Company` for
  `dealCount` + the two 90-day windows for `trendPct`. Merge in TS, order by
  `totalRaisedUsd` desc. Cast `BigInt`/`Decimal` sums via `Number()` as done today
  (`market.service.ts:17`).
- `getTotals()` — aggregate queries (`SUM(totalRaisedUsd)`, round count, unicorn count)
  + computed quarter label. Drop the `NotFoundException` path (always computable; empty
  DB returns zeros).

#### 3. Drop the seeded tables
**File**: `packages/db/prisma/schema.prisma:285-302`
**Changes**: delete `MarketStat` + `MarketSnapshot` models; migration
`yarn workspace @repo/db migrate` (name: `drop_seeded_market_tables`). Also add the
Phase-3 indexes in this same migration (see Phase 3.5) to avoid two migrations.

**File**: `packages/db/prisma/seed.ts`
**Changes**: remove `marketStats` array (line 228), the two `deleteMany` calls
(247-248), and both create blocks (369-386); update the summary log line (388).

#### 4. Web consumers
**File**: `apps/web/app/markets/page.tsx`
**Changes**: drop `getCompanies()` and the `companiesBySector` map (lines 10-23) —
`companyCount` now arrives on each stat. Rows are just `marketStats`.

**File**: `apps/web/app/markets/MarketTable.tsx:11`
**Changes**: `MarketRow` = `MarketStat` (companyCount now on the base type).

**File**: `apps/web/app/page.tsx:52`
**Changes**: the sector grid is `grid-cols-5` and will now receive ~14 stats — render
only the top 5 by capital (`marketStats.slice(0, 5)`; already sorted desc) and add a
ghost "All markets →" button to the `SectionHeader` note, matching the Companies
section's pattern (line 80).

**File**: `apps/web/app/markets/[sector]/page.tsx`
**Changes**: none in this phase (new sectors appear automatically via
`generateStaticParams` over the expanded `SECTORS`); its company list is fixed in
Phase 3.

**File**: `apps/web/lib/data.ts`
**Changes**: update `fallbackMarketStats` to include `companyCount` (keep 5 entries —
fallback is illustrative only); label tweak in the landing/markets hero: "New unicorns"
→ "Unicorns" (`app/page.tsx:46`, `app/markets/page.tsx:35`).

### Success Criteria:

#### Automated Verification:
- [x] Migration applies cleanly (created via `prisma migrate diff` + `migrate:deploy` —
      `migrate dev` is interactive-only in this environment)
- [x] `yarn build` + `yarn lint` pass
- [x] Seed still works: type-checked clean; **not executed** against the live DB —
      running it wipes the 11k ingested companies (it deletes + re-seeds 8 demo rows)
- [x] `curl localhost:3000/market/stats` returns >5 sectors, each with non-zero
      `companyCount`, and numbers consistent with
      `SELECT "primarySector", count(*) … GROUP BY 1` — 14 sectors returned
- [x] `curl localhost:3000/market/totals` returns non-zero totals and quarter `"Q3 2026"`
      ($250.7B raised, 5,286 deals, 8 unicorns)

#### Manual Verification:
- [ ] `/markets` shows ~14 sectors with plausible real numbers; sorting works
- [ ] `/markets/real-estate` (new sector) renders stats + its companies
- [ ] Landing shows top-5 sector cards + "All markets" link; layout intact at mobile width
- [ ] Trend column shows sane values (mostly small numbers, not NaN/∞)

**Implementation Note**: pause here for manual confirmation before Phase 3.

---

## Phase 3: Companies — Server-Side Search/Filter/Sort + Pagination

### Overview
`GET /companies` becomes a paginated, filterable endpoint. The web directory becomes
URL-driven with numbered pages. Every full-list consumer switches to a scoped query.

### Changes Required:

#### 1. Shared types
**New file**: `packages/api/src/domain/pagination.ts` (export from barrel)

```ts
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;     // 1-based
  pageSize: number;
}
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export type CompanySort = 'name' | 'raised' | 'valuation';
export type CompanyListQuery = {
  q?: string; sector?: Sector; stage?: Stage; status?: CompanyStatus;
  sort?: CompanySort; page?: number; pageSize?: number; slugs?: string;
};
```

#### 2. API endpoint
**New file**: `apps/api/src/companies/dto/list-companies.dto.ts`
**Changes**: `class-validator` query DTO implementing `CompanyListQuery` —
`@IsOptional()` on everything, `@IsIn(SECTORS)`/`@IsIn(STAGES)`/`@IsIn(COMPANY_STATUSES)`
for the vocab fields, `@IsIn(['name','raised','valuation'])` for sort,
`@Type(() => Number) @IsInt() @Min(1)` for `page`, `@Max(MAX_PAGE_SIZE)` for `pageSize`,
`@IsString()` for `q` and `slugs` (comma-separated slug list for the compare page).

**File**: `apps/api/src/companies/companies.controller.ts:25-28`
**Changes**: `findAll(@Query() query: ListCompaniesDto): Promise<Paginated<Company>>`.
(Confirm `main.ts` `ValidationPipe` has `transform: true`; enable if not.)

**File**: `apps/api/src/companies/companies.service.ts:62-68`
**Changes**: rewrite `findAllApproved(query)`:

```ts
const where: Prisma.CompanyWhereInput = {
  moderationStatus: 'APPROVED',
  ...(query.slugs && { slug: { in: query.slugs.split(',').filter(Boolean) } }),
  ...(query.q && {
    OR: [
      { name: { contains: query.q, mode: 'insensitive' } },
      { oneLiner: { contains: query.q, mode: 'insensitive' } },
    ],
  }),
  ...(query.sector && { primarySector: query.sector }),
  ...(query.stage && { stage: query.stage }),
  ...(query.status && { status: query.status }),
};
const orderBy =
  query.sort === 'raised' ? { totalRaisedUsd: 'desc' as const }
  : query.sort === 'valuation' ? { lastValuationUsd: { sort: 'desc' as const, nulls: 'last' as const } }
  : { name: 'asc' as const };
const [total, rows] = await this.prisma.$transaction([
  this.prisma.company.count({ where }),
  this.prisma.company.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
]);
return { items: rows.map((r) => toCompany(r)), total, page, pageSize };
```

#### 3. Web data seam
**File**: `apps/web/lib/data.ts:352-359`
**Changes**: `getCompanies(query?: CompanyListQuery): Promise<Paginated<Company>>` —
build a `URLSearchParams` from defined keys, fetch `/companies?${qs}`. Fallback path
filters/slices the mock array into the same `Paginated` shape so offline dev keeps
working.

#### 4. Directory page + pagination UI
**File**: `apps/web/app/companies/page.tsx`
**Changes**: parse `searchParams` (q/sector/stage/status/sort/page), call
`getCompanies(parsed)`, pass `{ result, initial }` down. `SectionHeader` note becomes
`${formatCount(result.total)} profiles`.

**File**: `apps/web/app/companies/CompanyDirectory.tsx`
**Changes**:
- Props: `{ result: Paginated<Company>; initial: … }`. Delete the `filtered` `useMemo`
  (96-117) — render `result.items` directly.
- Keep the debounced URL-mirroring effect (82-94) as the *driver*: add `page` handling
  (reset to page 1 whenever q/sector/stage/status/sort change; keep `page` param
  otherwise), and wrap `router.replace` in `useTransition` — dim the table
  (`opacity-60`) while `isPending`.
- "N shown" → `formatCount(total)` matches + current range (`1–25 of 3,412`).
- Render `<Pagination>` below the table.

**New file**: `apps/web/components/ui/pagination.tsx` (+ barrel export)
**Changes**: bespoke monochrome role component (no shadcn install needed): Prev/Next +
windowed page numbers (first, last, ±2 around current, ellipsis), each a `Button`
`variant="ghost" shape="box" size="sm"` `href` preserving current query params with the
target `page` (current page gets `variant="outline"`). Mono numerals per design system.

#### 5. Indexes
**File**: `packages/db/prisma/schema.prisma` (Company model — same migration as Phase 2)
**Changes**: add `@@index([moderationStatus, primarySector])`,
`@@index([moderationStatus, stage])`, `@@index([moderationStatus, status])`,
`@@index([moderationStatus, name])`, `@@index([moderationStatus, totalRaisedUsd])`.

#### 6. Other full-list consumers
- **Landing** `apps/web/app/page.tsx:12,87`: `getCompanies({ pageSize: 8, sort: 'raised' })`
  → `result.items` (drop `HOME_PREVIEW`/`slice`). Top-raised is a better shop window
  than alphabetical.
- **Sector page** `apps/web/app/markets/[sector]/page.tsx:20-22`:
  `getCompanies({ sector, page, pageSize: 25 })`; render `CompanyTable` +
  `<Pagination>`; note becomes `${formatCount(total)} in ${sector}`. Reads `?page=`
  from its own `searchParams`.
- **Compare** `apps/web/app/compare/page.tsx:37`: resolve selected slugs via
  `getCompanies({ slugs: slugs.join(',') })` (≤4 rows). Replace the 11k-option
  `<Select>` picker:
  - **New file** `apps/web/app/api/companies/search/route.ts` — route handler proxying
    `apiFetch('/companies?q=…&pageSize=10')` (API_URL is server-only), returning
    `{ slug, name, domain }[]`.
  - **File** `apps/web/app/compare/ComparePicker.tsx` — becomes a search combobox:
    `Input` + debounced fetch to the route handler + results list (reuse `controlClass`
    surface + `CompanyLogo`); selecting pushes the extended `?companies=` URL exactly as
    today (`ComparePicker.tsx:21`).

### Success Criteria:

#### Automated Verification:
- [x] Migration applies: `yarn workspace @repo/db migrate` (shared with Phase 2)
- [x] `yarn build` + `yarn lint` pass
- [x] `curl 'localhost:3000/companies?pageSize=5'` → 5 items, `total` = 11,055
- [x] `curl 'localhost:3000/companies?sector=Real%20estate&page=2'` → page 2, filtered
- [x] `curl 'localhost:3000/companies?q=capital&sort=raised'` → matches sorted by raised
- [x] `curl 'localhost:3000/companies?pageSize=500'` → 400 (validation rejects > MAX)
- [x] `curl 'localhost:3000/companies?slugs=a,b'` → only those slugs
      (also: page beyond last → empty items, not an error)

#### Manual Verification:
- [ ] `/companies` initial load is fast; ~25 rows; total count shown
- [ ] Typing in search updates URL after debounce, table refreshes server-side, page
      resets to 1; browser back/forward replays filter states
- [ ] Header search (`SiteHeader`) deep-link `/companies?q=…` pre-filters correctly
- [ ] Pagination: page numbers, prev/next, ellipsis; deep link `?page=7` works
- [ ] Sector pages paginate; landing shows top-raised 8; compare picker search finds
      companies by name and comparison still builds up via URL

**Implementation Note**: pause here for manual confirmation before Phase 4.

---

## Phase 4: Investors — SQL Aggregation + Server-Side Pagination

### Overview
Replace the load-everything-and-group approach with grouped queries and the same
paginated, URL-driven directory pattern.

### Changes Required:

#### 1. Shared types
**File**: `packages/api/src/domain/pagination.ts`
**Changes**: add `type InvestorSort = 'portfolio' | 'name'` and
`InvestorListQuery = { q?, type?: InvestorType, sort?, page?, pageSize? }`.

#### 2. API
**New file**: `apps/api/src/investors/dto/list-investors.dto.ts` — mirrors the companies
DTO (`@IsIn(INVESTOR_TYPES)` for `type`).

**File**: `apps/api/src/investors/investors.service.ts` (rewrite `findAll`)
**Changes**: three-step query, keeping the existing `mode()`/sample logic
(`investors.service.ts:18-31,67-75`) but scoped to one page:

```ts
const where: Prisma.InvestorHoldingWhereInput = {
  moderationStatus: 'APPROVED',
  company: { moderationStatus: 'APPROVED' },
  ...(query.q && { name: { contains: query.q, mode: 'insensitive' } }),
  ...(query.type && { type: query.type }),
};
// 1. total distinct investors
const total = (await this.prisma.investorHolding.groupBy({ by: ['name'], where })).length;
// 2. page of names — groupBy + orderBy aggregate + skip/take
const pageGroups = await this.prisma.investorHolding.groupBy({
  by: ['name'], where,
  orderBy: query.sort === 'name'
    ? [{ name: 'asc' }]
    : [{ _count: { name: 'desc' } }, { name: 'asc' }],
  skip, take,
});
// 3. all holdings for just those names → existing accumulator logic
```

Note: portfolio-count ordering by `_count` counts *holdings*, while `portfolioCount`
dedupes companies — acceptable drift (one holding row per company per investor is the
norm); document with a comment.

#### 3. Web
**File**: `apps/web/lib/data.ts:396-403` — `getInvestors(query?)` →
`Paginated<InvestorSummary>`; fallback adapts.

**File**: `apps/web/app/investors/page.tsx` — parse `searchParams`, fetch, pass result;
note = `${formatCount(total)} firms`.

**File**: `apps/web/app/investors/InvestorDirectory.tsx` — same refactor as
`CompanyDirectory`: drop the `useMemo` filter (58-72), URL-driven with page reset,
`useTransition` pending state, `<Pagination>` (reused component) below the table.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build` + `yarn lint` pass
- [x] `curl 'localhost:3000/investors?pageSize=5'` → 5 summaries, `total` = 771
- [x] `curl 'localhost:3000/investors?q=capital&type=Venture'` → filtered results (67 total)
- [x] `curl 'localhost:3000/investors?sort=name&page=2'` → alphabetical page 2

#### Manual Verification:
- [ ] `/investors` paginates; search + type filter round-trip via URL
- [ ] Portfolio counts and sample companies match a spot-checked investor's holdings
- [ ] Empty result state renders for a nonsense query

---

## Testing Strategy

### Unit Tests (jest, `yarn workspace jobs test`):
- `sector-map.spec.ts`: every enumerated Form D value maps; unknown/empty → null.
- `wikidata.mapper.spec.ts`: rule ordering (payment→Fintech before Financial services;
  solar→Climate before Energy); unmatched text → null.
- SEC source spec: normalized record carries `primarySector` for a mapped industry.

### Integration (manual curl, per-phase criteria above):
- Pagination math (`total`, boundaries: page beyond last → empty items, not error).
- Filter combinations (`q` + `sector` + `sort`).
- Market stats cross-checked against direct SQL counts.

### Manual Testing Steps:
1. `make dev`, run Phase-1 backfill, walk `/`, `/companies`, `/investors`, `/markets`,
   `/markets/[sector]`, `/compare` end-to-end.
2. Kill the API and confirm every page still renders on fallback data (offline dev).
3. Browser back/forward through filter + page states on both directories.

## Performance Considerations

- Payloads drop from ~11k rows to ≤100 per request; the 60s ISR cache in `lib/api.ts`
  now caches per-URL (each filter/page combo its own entry) — fine, entries are small.
- Market stats: two grouped aggregates over 11k/5k rows per (cached) request — sub-10ms;
  no materialization needed at this scale.
- Investor `groupBy` for `total` returns ~771 rows just to count — acceptable; swap for
  `$queryRaw COUNT(DISTINCT name)` only if it ever shows up in profiles.
- New composite indexes keep filtered pages index-driven as ingestion grows the table.

## Migration Notes

- One Prisma migration (Phase 2/3 shared): drops `MarketStat`/`MarketSnapshot` (seeded
  data, safe to lose) + adds Company indexes. Prod: `prisma migrate deploy` runs on api
  container boot (existing behavior).
- `GET /companies` and `GET /investors` change response shape (array →
  `Paginated<T>`). The web app is the only consumer and updates in the same phase; api
  + web deploy together (single compose stack), so no compatibility shim is needed.
- Run `make backfill-sectors` once after deploying Phase 1 (idempotent; safe to re-run).

## Implementation Notes (2026-07-19)

All four phases implemented in one pass. Deviations / decisions made during
implementation:

- **Migration workflow**: `prisma migrate dev` refuses non-interactive terminals, so the
  migration (`20260718225443_drop_seeded_market_tables_add_directory_indexes`) was
  generated with `prisma migrate diff --from-config-datasource --to-schema` and applied
  with `migrate:deploy`. Single migration covers the table drops + all five indexes.
- **Makefile**: also added a `backfill-sectors-prod` target (container variant), mirroring
  the `ingest`/`ingest-prod` pair.
- **Landing sectors header**: renamed "Sectors this quarter" → "Top sectors" since it now
  shows the top 5 of ~14 markets, with the "All markets →" ghost button as the note.
- **ComparePicker**: bespoke search combobox (debounced `Input` + result list with
  `CompanyLogo`), backed by the new `/api/companies/search` route handler. The route's
  `CompanySearchHit` type is exported and imported by the picker.
- **URL-mirroring effects** (both directories): the debounced replace now *skips the
  mount run* (`useRef` flag) so a deep-linked `?page=N` isn't stripped on load; any real
  filter change still resets to page 1. `useTransition` dims the table while refetching.
- **Shared types**: `InvestorListQuery`/`INVESTOR_SORTS` were created in Phase 3's
  `pagination.ts` module rather than edited in later in Phase 4 (one module, one story).
- **Seed**: deliberately **not executed** — it wipes all companies and re-seeds the 8
  demo rows, which would destroy the 11k ingested companies. Type-checked instead.
- **Backfill results**: 7,921 sectors filled (9,589 scanned); NULL sectors 9,992 → 2,071.
  Top markets by company count: Financial services 2,221 · Real estate 1,582 ·
  Technology 1,008 · Transport 877 · Industrials 814.
- **Data notes for manual review**: SEC-heavy sectors show `medianValuationUsd: 0` (Form
  D discloses no valuations); trendPct values are large (+200–400%) because recent
  ingestion backfilled the trailing 90 days more densely than the prior window — the
  math is correct, the corpus is just young. "European Investment Bank" tops the
  portfolio sort with 5,563 companies (Wikidata P1951 data) — real, if surprising.

## References

- Prior related plans: `thoughts/shared/plans/2026-07-03-browse-pages-and-filtering.md`
  (introduced the client-side directories), `2026-06-25-data-enhancements-metadata-and-sectors.md`
  (introduced `primarySector` + the 5-sector vocab),
  `2026-07-15-job-scraper-backfill-and-enrichment.md` (ingestion/backfill patterns)
- Key files: `apps/api/src/companies/companies.service.ts:62`,
  `apps/api/src/investors/investors.service.ts:38`,
  `apps/api/src/market/market.service.ts:10`,
  `packages/api/src/domain/company.ts:35`, `packages/db/prisma/schema.prisma:286`,
  `apps/jobs/src/sources/sec-edgar/sec-edgar.source.ts:92`,
  `apps/jobs/src/sources/wikidata/wikidata.mapper.ts:25`,
  `apps/web/app/companies/CompanyDirectory.tsx:96`
