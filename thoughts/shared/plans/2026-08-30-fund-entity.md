# Funds as a first-class entity — Implementation Plan

## Overview

Add a `Fund` table: one row per private fund, with a required FK to the
`Investor` that manages it, plus strategy, vintage year, target/closed size and
gross assets. Two SEC sources fill it, and they are complementary rather than
redundant:

- **Form ADV Schedule D 7.B.(1)** supplies the manager link (structurally, via
  CRD), the fund name, its type and its gross asset value — **but no vintage and
  no fund size**.
- **Pooled-fund Form D filings** — 63% of every Form D we already fetch and
  currently throw away — supply vintage, target size, capital closed and a
  strategy signal, **but never name the manager**.

The join between them is the fund's own name, and it works: 35.4% of pooled
Form D filings in a 2023 sample match an ADV Schedule D fund exactly.

Surface: a fund list on the investor profile and a `/funds` directory.

## Current State Analysis

`Investor` (`packages/db/prisma/schema.prisma:275`) carries `fundCount` and
`assetsUsd` as flat scalars, read from the monthly Form ADV roster by
`mapAdvRows` (`apps/jobs/src/sources/sec-adv/adv.parser.ts:280`). Andreessen
Horowitz's row says 119 funds and $106.5bn — and names none of them.

Live corpus (local DB, 2026-08-30):

```
companies 35642   rounds 134359   people 46306
investors  7489   (6720 with a CRD, 6646 with SEC_ADV provenance)
holdings   1186   citations 224315 / sources 36913
```

The 74-row gap between `crdNumber` and `SEC_ADV` provenance matters: Andreessen
Horowitz's row was created by another source and later *enriched* by
`upsertInvestorFirm` (`apps/jobs/src/ingest/ingest.service.ts:378`), which fills
blanks without claiming provenance. **The CRD → Investor lookup must key on
`crdNumber`, not `externalId`.**

`SecEdgarSource` (`apps/jobs/src/sources/sec-edgar/sec-edgar.source.ts:54`)
fetches every Form D primary document, parses it, and then discards the pooled
funds — after paying the rate-limited fetch. Routing them somewhere is close to
free, exactly as the ticket says.

### Three corrections to the ticket

I pulled both datasets before planning.

**1. Schedule D is not in the monthly ADV download, and it has neither vintage
nor fund size.**

The monthly roster ZIP the existing source reads contains exactly one member —
`IA_SEC_-_FIRM_ROSTER_FOIA_DOWNLOAD_*.CSV`, 6.5 MB — the firm-level rollup. No
Schedule D. The per-fund detail is published separately, as the **Form ADV
Part 1 Data Files** on the FOIA page:

```
https://www.sec.gov/foia-services/frequently-requested-documents/form-adv-data
  /files/adv-filing-data-20111105-20241231-part1.zip   701,619,239 bytes
  /files/adv-filing-data-20111105-20241231-part2.zip   428,897,563 bytes
```

Four members inside them matter:

| member | zip | compressed | uncompressed |
|---|---|---|---|
| `ERA_ADV_Base_20111105_20241231.csv` | part1 | 7.5 MB | 35 MB |
| `ERA_Schedule_D_7B1_20111105_20241231.csv` | part1 | 13.7 MB | 84 MB |
| `IA_ADV_Base_A_20111105_20241231.csv` | part1 | 95 MB | 533 MB |
| `IA_Schedule_D_7B1_20111105_20241231.csv` | part2 | 64 MB | 396 MB |

`7B1` header, verified:

```
FilingID, Fund Name, Fund ID, ReferenceID, State, Country, 3(c)(1) Exclusion,
3(c)(7) Exclusion, Master Fund, Feeder Fund, Master Fund Name, Master Fund ID,
Fund of Funds, …, Fund Type, Fund Type Other, Gross Asset Value,
Minimum Investment, Owners, …, Prime Brokers, Custodians, Administrator, Marketing
```

`Fund ID` is the SEC private fund identification number (`805-1534393064`).
`Gross Asset Value` is NAV as of the filing — **not** capital raised. There is no
inception date column: Form ADV does not ask when a fund was raised. So the
ticket's "vintage year, target size, closed size" cannot come from ADV.

`7B1` carries no CRD either, only `FilingID`. The join is `1E1` (Organization
CRD#) in the matching `*_ADV_Base` file, alongside `DateSubmitted`.

**The archive is frozen at 2011-11-05 → 2024-12-31.** It is re-cut occasionally,
not monthly, and the date range is part of the filename — so the client must
scrape the page for links, never construct one, exactly as `parseAdvSnapshots`
(`apps/jobs/src/sources/sec-adv/adv.client.ts:144`) already does for the roster.

Joined against the 6,720 investors that already carry a CRD:

```
95,538 distinct funds across 5,531 managers
  41,393 Private Equity Fund   41,030 Venture Capital Fund
   4,766 Hedge Fund             4,570 Other Private Fund
   2,378 Real Estate Fund       1,326 Securitized Asset Fund      43 Liquidity Fund
43,575 report gross assets over $10M; 6,344 report zero
Andreessen Horowitz (CRD 160489) → 92 named funds, largest $3.03bn
```

**2. Pooled Form D is richer than the ticket says in one place and poorer in
another.**

Two 400-filing samples (Aug 2026 and Jun 2023 daily indexes) agree: **63% and
62% of Form D filings are pooled funds.** Each carries, in
`offeringData.industryGroup.investmentFundInfo.investmentFundType`, a structural
strategy the current parser never reads:

| `investmentFundType` | Aug 2026 | Jun 2023 |
|---|---|---|
| Venture Capital Fund | 85 | 69 |
| Private Equity Fund | 68 | 29 |
| Other Investment Fund | 61 | 68 |
| Hedge Fund | 38 | 80 |

But **`totalOfferingAmount` is the literal string `"Indefinite"` for 51% (2026)
to 67% (2023) of them.** `num()` in `form-d.parser.ts:242` strips non-digits and
would silently turn that into `0` — a target size of zero dollars. Target must be
nullable and "Indefinite" must map to null, not 0.

**3. The manager is not in the Form D filing, and guessing it from the fund's
name is unsafe.**

a16z's Fund X-B (accession `0001104659-26-084290`) lists Marc Andreessen and Ben
Horowitz as related persons with the clarification "Managing Member of the GP of
the Issuer's GP". No manager firm anywhere in the document. Measured on the 2023
sample:

| route to a manager | hit rate on 246 pooled filings |
|---|---|
| exact normalized fund-name join → an ADV Schedule D fund | **35.4%** (87) |
| longest-prefix guess against the `Investor` name index | +0.8% (2) |

The prefix route adds almost nothing and its *first* hit was a false positive:
`Venture Capital Portfolio TE 2023 LP` → an `Investor` row literally named
**"venture capital"**. (There is a `"private equity"` row too.) That is the
failure mode `onlyIfKnown` exists to prevent, so this plan does not use it. The
manager comes from the structural ADV join or the fund is not published.

## Desired End State

```bash
make ingest SOURCE=SEC_ADV       LIMIT=1000000 DAYS=1   # investor universe (existing)
make ingest SOURCE=SEC_ADV_FUNDS LIMIT=1000000 DAYS=1   # new
make ingest SOURCE=SEC_EDGAR     DAYS=3650              # now also emits fund closes
make backfill-citations
```

produces roughly:

```
funds ~95,000 across ~5,500 managers
  … of which a growing share carry a vintage year, target and closed size
    from a matched pooled Form D filing
```

and:

- `/investors/andreessen-horowitz` shows a **Funds** section: "119 reported ·
  92 named", the largest funds by gross assets with strategy, vintage and size,
  each with a `[SEC]` citation marker.
- `/funds` is a directory of every fund — search, strategy filter, sort by size
  or vintage, paginated — matching the `/investors` pattern exactly.
- The daily Form D cron keeps enriching funds with no extra SEC requests.

### Key discoveries

- `IngestionSource` (`apps/jobs/src/sources/ingestion-source.ts:161`) already has
  the shape for this: `fetch()` for companies, optional `fetchInvestors()` for a
  detached firm universe. Funds are a third kind and take an optional
  `fetchFunds()` alongside them — one DI token, one `INGEST_SOURCES` variable.
- `createCsvParser` (`apps/jobs/src/util/csv.ts:39`) is a streaming RFC 4180
  parser built for exactly this: the ADV CSVs are **not** line-splittable (the
  Form C plan established this), and `IA_ADV_Base_A` is 533 MB uncompressed.
- A ZIP member can be read without downloading the archive: range-fetch the tail
  for the central directory, then range-fetch the member's compressed extent and
  pipe it through `zlib.createInflateRaw()`. **~180 MB total instead of 1.1 GB.**
  No new dependency — `node:zlib` and `node:stream` are built in; `fflate`'s
  `unzipSync` cannot do this (it buffers, and a 396 MB member would exceed
  Node's string limit anyway).
- Fund names are near-unique: only **191 of 94,399** normalized fund names
  (0.20%) are claimed by more than one manager, and they are degenerate — `fund
  5`, `fund b`, `94`. Dropping the ambiguous ones from the match index costs
  nothing and removes the mis-attribution risk entirely.
- `titleCaseFirm` (`apps/jobs/src/util/text.ts:15`) already preserves roman
  numerals specifically because they "distinguish fund vintages" — the ADV
  ALL-CAPS names title-case correctly with no changes.
- `CitableType = Exclude<ReviewableType, 'proposal'>`
  (`packages/api/src/domain/provenance.ts:26`) is a convenience, not a law.
  Widening it to `… | 'fund'` gives funds citations without dragging them into
  `countsByType` (`apps/api/src/admin/admin.service.ts:207`) or `moderate()`.
- Ingest match-and-enrich rules (`ingest.service.ts:447`) already encode the
  right instinct: fill blanks, never overwrite, never let a name match change an
  identity field. `upsertFund` reuses that shape verbatim.
- The `Fund` table's biggest managers are SPV platforms: AngelList's "Platform
  Advisor, LLC" (CRD 167700) reports **22,277** funds named `AL-<COMPANY>-FUND,
  LLC` with gross assets of $101 and $543. Gaingels (734), Alumni Ventures (745),
  EquityBee (582) and Microangel (843) are the same shape. **Decision: ingest
  them all** — they are genuinely reported private funds and a size floor would
  discard real small funds too — and handle it in presentation, by sorting fund
  lists by gross assets and paginating.

## What We're NOT Doing

- **Fund performance (IRR / TVPI / DPI).** The ticket defers it pending a spike
  on public-pension disclosure formats. Not scoped here, and no columns for it.
- **Fund → portfolio company edges.** Neither source discloses them. `/funds`
  rows link to the manager, not to companies.
- **Per-fund detail pages, and therefore no `slug` column.** A fund row has
  nothing a dedicated page would add beyond what the directory line shows, and
  minting ~95k unique slugs is real cost for no reader.
- **Fund contribution forms or moderation.** `Fund` is ingest-only, auto-
  `APPROVED`, like `FundingRound.kind`. It keeps a `moderationStatus` column so
  the read path matches its siblings and a later ticket can open it up, but
  nothing ever leaves it `PENDING` and the admin queue never lists funds.
- **Revisions on funds.** `Revision.companyId` is required and a fund has no
  company. Funds get citations, not a timeline.
- **Prefix-matching a manager out of a fund's name.** Measured at +0.8% with an
  immediate false positive; see corrections above.
- **Backfilling vintage for the 2025–2026 funds ADV cannot see.** The archive
  stops at 2024-12-31. Those funds appear once the SEC re-cuts it; until then a
  2026 pooled Form D with no ADV match is skipped and counted.
- **Master/feeder structure, prime brokers, custodians, placement agents.** All
  present in Schedule D sub-tables; none asked for.

## Implementation Approach

Four phases, in dependency order. The ordering is forced by the manager rule:
funds only exist once their manager does, and Form D can only enrich a fund the
ADV pass already created.

Phase 1 lands the schema, vocabulary and ingest plumbing with no source behind
it yet. Phase 2 brings the ADV archive and, on its own, satisfies the ticket's
headline complaint. Phase 3 makes the daily Form D cron pay for vintage and size.
Phase 4 exposes it and cites it.

---

## Phase 1: `Fund` schema, vocabulary and the ingest contract

### Overview

The table, the shared types, and `IngestService.upsertFund` — everything a source
needs to exist against. No source writes funds yet, so this phase is verifiable
by migration + type-check + a unit test on the new match index.

### Changes Required

#### 1. Schema

**File**: `packages/db/prisma/schema.prisma`

```prisma
/// One private fund managed by an Investor. Unlike Investor.fundCount — a
/// scalar rollup Form ADV reports at firm level — this names the fund, and
/// where a Form D filing matched, dates and sizes it.
model Fund {
  id        String   @id @default(cuid())
  name      String
  /// Manager. Required: a fund with no resolvable manager is not published —
  /// the ADV Schedule D join is the only structural route to one, and guessing
  /// it from the fund's name mis-attributes (see the plan's measurements).
  managerId String
  manager   Investor @relation(fields: [managerId], references: [id], onDelete: Cascade)

  /// One of FUND_STRATEGIES. Null when neither source typed it.
  strategy String?
  /// Year the fund entity was formed (Form D `yearOfInc`) — the closest thing
  /// the public record has to a vintage. Form ADV discloses no inception date.
  vintageYear Int?
  /// Target raise (Form D `totalOfferingAmount`). Null when the filing says
  /// "Indefinite", which it does for 51–67% of pooled filings.
  targetUsd BigInt?
  /// Capital sold to date (Form D `totalAmountSold`).
  closedUsd BigInt?
  /// Gross asset value as last reported on Form ADV Schedule D 7.B.(1). NAV at
  /// filing time, NOT capital raised — the two are different facts.
  grossAssetsUsd BigInt?
  /// ISO 4217. Both sources report USD only; the column exists so a non-US
  /// source later cannot silently be read as dollars.
  currency String @default("USD")
  hq       String?

  /// SEC private fund identification number (805-XXXXXXXXXX), from Schedule D.
  secFundId String?
  /// The fund's own filer CIK, when a Form D filing matched it.
  cikNumber String?

  // Provenance for the row's creator (SEC_ADV_FUNDS | SEC_EDGAR). The *other*
  // source's identifier survives in secFundId / cikNumber, so both documents
  // stay citable however the row was created.
  externalSource String?
  externalId     String?

  moderationStatus ReviewStatus @default(PENDING)
  submittedById    String?
  submittedBy      User?        @relation(fields: [submittedById], references: [id], onDelete: SetNull)
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  @@unique([externalSource, externalId])
  @@index([managerId])
  @@index([moderationStatus])
  @@index([moderationStatus, strategy])
  @@index([moderationStatus, vintageYear])
  @@index([moderationStatus, grossAssetsUsd])
  @@index([moderationStatus, name])
}
```

Add the back-relations: `funds Fund[]` on `Investor` (line ~304, beside
`holdings`) and `funds Fund[]` on `User` (line ~49, beside `citations`).

Migration name: `add_fund_entity`. Pure additive DDL — no data step.

#### 2. Shared vocabulary and types

**File**: `packages/api/src/domain/company.ts`

Form ADV and Form D publish two different fund-type vocabularies. Both map
deterministically into one canonical set — no inference, just a rename:

```ts
/** What kind of capital a fund deploys. Both SEC sources publish a fund type as
 *  a structured field, so this is read, never guessed:
 *    Form ADV Schedule D 7.B.(1) `Fund Type` — Hedge Fund | Private Equity Fund |
 *      Venture Capital Fund | Real Estate Fund | Securitized Asset Fund |
 *      Liquidity Fund | Other Private Fund
 *    Form D `investmentFundType` — Hedge Fund | Private Equity Fund |
 *      Venture Capital Fund | Other Investment Fund
 */
export type FundStrategy =
  | 'Venture capital'
  | 'Private equity'
  | 'Hedge fund'
  | 'Real estate'
  | 'Securitized asset'
  | 'Liquidity'
  | 'Other';

export const FUND_STRATEGIES: readonly FundStrategy[] = [
  'Venture capital',
  'Private equity',
  'Hedge fund',
  'Real estate',
  'Securitized asset',
  'Liquidity',
  'Other',
];
```

**New file**: `packages/api/src/domain/fund.ts`

```ts
import type { FundStrategy } from './company';

/** One private fund, with the manager it belongs to. */
export interface Fund {
  /** Row identity — what a Citation anchors to. Funds have no slug: there is
   *  no per-fund page, so nothing addresses one by name. */
  id: string;
  name: string;
  strategy?: FundStrategy | null;
  vintageYear?: number | null;
  /** Target raise. Null is common and honest: most pooled Form D filings
   *  declare an indefinite offering. */
  targetUsd?: number | null;
  /** Capital closed to date (Form D). */
  closedUsd?: number | null;
  /** Gross asset value as last reported on Form ADV — NAV, not capital raised. */
  grossAssetsUsd?: number | null;
  currency: string;
  hq?: string | null;
}

/** A fund plus enough of its manager to render a directory row. */
export interface FundSummary extends Fund {
  manager: { slug: string; name: string; domain: string | null };
}
```

**File**: `packages/api/src/domain/pagination.ts`

```ts
export type FundSort = 'size' | 'vintage' | 'name';

export const FUND_SORTS: readonly FundSort[] = ['size', 'vintage', 'name'];

export interface FundListQuery {
  q?: string;
  strategy?: FundStrategy;
  /** Restrict to one manager (the investor profile's "see all funds" link). */
  manager?: string; // investor slug
  sort?: FundSort;
  page?: number;
  pageSize?: number;
}
```

**File**: `packages/api/src/domain/provenance.ts`

```ts
/** Everything reviewable is citable, except a proposal (which is itself a
 *  change) — plus `fund`, which is citable without being reviewable: funds are
 *  ingest-only, so they never enter the moderation queue. */
export type CitableType = Exclude<ReviewableType, 'proposal'> | 'fund';

export const CITABLE_TYPES: readonly CitableType[] = [
  'company', 'round', 'person', 'investor', 'acquisition', 'exit', 'diversity', 'fund',
];
```

`RevisableType` in `apps/api/src/provenance/revision.util.ts:11` stays
`Exclude<ReviewableType, 'proposal'>` and is unaffected — funds write no
revisions. Export `./domain/fund` from `packages/api/src/entry.ts`.

#### 3. Ingestion contract

**File**: `apps/jobs/src/sources/ingestion-source.ts`

```ts
/** One private fund contributed by a source. */
export interface NormalizedFund {
  /** Stable id of the fund within the source: the SEC private fund id
   *  (805-…) for Form ADV, the fund's filer CIK for Form D. */
  externalId: string;
  name: string;
  /**
   * CRD of the managing firm, when the source knows it structurally.
   *
   * Form ADV does (Schedule D is filed BY the manager). Form D does not — its
   * related persons are the GP's individuals, never the firm — so a Form D fund
   * leaves this null and resolves its manager by matching an existing Fund row
   * on name. A fund that resolves neither way is dropped, not guessed at.
   */
  managerCrd?: string | null;
  strategy?: FundStrategy | null;
  vintageYear?: number | null;
  /** Null when the offering is indefinite; never 0 for "unknown". */
  targetUsd?: number | null;
  closedUsd?: number | null;
  grossAssetsUsd?: number | null;
  hq?: string | null;
  secFundId?: string | null;
  cikNumber?: string | null;
}

export interface IngestionSource {
  readonly name: string;
  fetch(opts: FetchOptions): Promise<NormalizedRecord[]>;
  fetchInvestors?(opts: FetchOptions): Promise<NormalizedInvestorFirm[]>;
  /**
   * Private funds this source contributes. Called once per run, immediately
   * after `fetch`.
   *
   * SEC_ADV_FUNDS fetches independently. SEC_EDGAR instead *drains* funds its
   * `fetch` collected while walking Form D filings — re-walking the index to
   * find them again would double the rate-limited SEC traffic for filings we
   * already downloaded and parsed. Draining is why the call order is fixed and
   * why a second call returns nothing.
   */
  fetchFunds?(opts: FetchOptions): Promise<NormalizedFund[]>;
}
```

#### 4. `IngestService.upsertFund`

**File**: `apps/jobs/src/ingest/ingest.service.ts`

A `FundIndex` alongside `MatchIndex` / `InvestorIndex`:

```ts
/** Lookup tables for funds (one query per run). */
interface FundIndex {
  /** `${externalSource}:${externalId}` → fund id. */
  byKey: Map<string, string>;
  /**
   * normalizeFundName(name) → fund id. Names claimed by more than one manager
   * are REMOVED rather than first-wins: 191 of 94,399 ADV fund names collide
   * (`fund 5`, `fund b`, `94`), and a Form D filing carries no manager to
   * disambiguate with, so an ambiguous name must match nothing.
   */
  byName: Map<string, string>;
  /** normalizeFundName(name) → manager id, used to detect the collisions above. */
  managerByName: Map<string, string>;
  /** Investor.crdNumber → investor id. Keyed on the column, not on
   *  (externalSource, externalId): 74 investors carry a CRD from enrichment
   *  without carrying SEC_ADV provenance — Andreessen Horowitz among them. */
  investorByCrd: Map<string, string>;
}
```

`upsertFund(fund, source, index)` mirrors `upsertInvestorFirm`
(`ingest.service.ts:378`):

1. `byKey` hit → our own row; the source is authoritative for the fields it
   publishes.
2. `byName` hit → **enrich**: fill only blank columns, never overwrite (same
   rule as `enrichInvestor`, `ingest.service.ts:447`). This is the ADV↔Form D
   merge — a Form D filing pours vintage/target/closed into a fund ADV named,
   and stamps `cikNumber`; an ADV run over a Form-D-created row pours in
   `grossAssetsUsd`/`secFundId`/`strategy`.

   **When the incoming fund carries a `managerCrd`, the matched row's manager
   must be that same firm** — otherwise fall through to create. Only Form D
   funds, which have no manager of their own, may take a name match's manager on
   trust; an ADV fund knows whose it is and must never be merged into another
   firm's identically-named one.
3. Otherwise resolve a manager: `investorByCrd.get(fund.managerCrd)`. **No CRD
   or no match → return without writing, and count it.** This one branch is what
   keeps every `Fund.managerId` real: it is the `onlyIfKnown` rule
   (`ingestion-source.ts:41`) applied to funds.
4. Create, then update `byKey`, `byName` and `managerByName` — removing the
   `byName` entry when the new fund's name is already held by a different
   manager, so the collision resolves to neither.

`run()` loads the index once (`loadFundIndex()`, beside `loadMatchIndex` and
`loadInvestorIndex` at `ingest.service.ts:98`), and `IngestResult` gains
`funds: number`. After `fetch()`, `run()` calls `source.fetchFunds?.()` and loops
with the same per-row try/catch and `% 1000` progress log the other two loops
use.

`normalizeFundName` is exported next to `normalizeInvestorName`
(`ingest.service.ts:682`) and delegates to it today:

```ts
/**
 * Fund-name key for matching an ADV Schedule D fund to a Form D filing.
 *
 * The investor rules are the right ones today — strip trailing legal forms
 * only, keep every meaning-bearing word — and they were what produced the
 * measured 35.4% join rate. Kept as its own function so fund-specific rules
 * (series suffixes, vintage numerals) can be added without touching firm
 * matching, where the same change would be wrong.
 */
export const normalizeFundName = normalizeInvestorName;
```

### Success Criteria

#### Automated Verification:
- [x] Migration applies cleanly: `make db-migrate`
- [x] Prisma client regenerates: `yarn workspace @repo/db generate`
- [x] Whole monorepo builds: `yarn build`
- [x] Type checking passes across workspaces: `yarn build` (turbo, `tsc -b`)
- [x] Lint passes at `--max-warnings 0`: `yarn lint`
- [x] Jobs unit tests pass: `yarn workspace jobs test`
- [x] New spec covers `FundIndex` collision removal: a name held by two managers
      resolves to neither
- [x] API tests still pass: `yarn workspace api test`

#### Manual Verification:
- [ ] `\d "Fund"` in psql shows the FK to `Investor` as NOT NULL
- [ ] Admin queue at `/admin` is unchanged — no `fund` tab, `countsByType` has
      no `fund` key

**Implementation Note**: pause here for confirmation before Phase 2.

---

## Phase 2: `SEC_ADV_FUNDS` — Form ADV Schedule D 7.B.(1)

### Overview

A snapshot source shaped like `SEC_ADV`: `fetch()` returns `[]`, `days` is
ignored, it stays off the daily cron. It reads four ZIP members by HTTP range
request rather than downloading 1.1 GB.

### Changes Required

#### 1. ZIP-member range reader

**New file**: `apps/jobs/src/util/zip-range.ts`

```ts
/**
 * Read one member of a remote ZIP without downloading the archive.
 *
 * The Form ADV Part 1 archives are 700 MB and 429 MB, and we need four members
 * totalling ~180 MB compressed. A ZIP's central directory sits at the end, so
 * one range request for the tail yields every member's offset and compressed
 * size; a second range request for that extent, piped through inflateRaw, is
 * the member. `fflate`'s unzipSync cannot do this — it buffers the whole
 * archive, and one member alone is 396 MB uncompressed.
 */
export interface ZipEntry { name: string; offset: number; compressedSize: number; uncompressedSize: number }

export function parseCentralDirectory(tail: Uint8Array): ZipEntry[];
export async function streamZipMember(
  url: string, entry: ZipEntry, userAgent: string, onChunk: (text: string) => void,
): Promise<boolean>;
```

`parseCentralDirectory` scans for the `PK\x01\x02` signature and unpacks the
46-byte fixed header (little-endian: compressed size at +20, uncompressed at
+24, name length at +28, local-header offset at +42). It is a pure function and
gets its own spec against a fixture built with `fflate.zipSync`.

`streamZipMember` range-fetches `[offset, offset + compressedSize + 8192]`,
skips the local file header (30 bytes + name length + extra length, read from
the first bytes), and pipes the rest through `zlib.createInflateRaw()`,
decoding `latin-1` — the same encoding `AdvClient.fetchCsv`
(`adv.client.ts:90`) already uses for these files.

Reads `Content-Length` with a `HEAD` first; a server that ignores `Range`
(status 200 rather than 206) is a hard failure, logged and returned as `false`,
never silently treated as data.

#### 2. Client

**New file**: `apps/jobs/src/sources/sec-adv/adv-archive.client.ts`

```ts
export const ADV_ARCHIVE_INDEX_URL =
  'https://www.sec.gov/foia-services/frequently-requested-documents/form-adv-data';

export interface AdvArchive {
  /** Range label shared by both zips, e.g. `20111105-20241231`. */
  label: string;
  part1: string;
  part2: string;
}

/**
 * Pair the Form ADV Part 1 data archives linked from the FOIA page.
 *
 * Filenames encode the range they cover (`adv-filing-data-20111105-20241231-part1.zip`)
 * and the SEC re-cuts them occasionally, so the page is scraped and the newest
 * range wins. The 2000-10-19 → 2011-11-04 archive is deliberately excluded:
 * Schedule D 7.B.(1) did not exist before the 2011 Form ADV revision, which is
 * exactly why the current archive starts on 2011-11-05.
 */
export function parseAdvArchives(html: string): AdvArchive[];
```

`AdvArchiveClient` reuses the roster client's throttle contract verbatim — the
SEC's 10 req/s cap is per-IP across every `sec.gov` host — and honours
`SEC_USER_AGENT`. `ADV_ARCHIVE` pins a range label for reproducible runs, the
same way `ADV_SNAPSHOT` pins a roster month. The resolved label and both URLs
are logged.

#### 3. Parser

**New file**: `apps/jobs/src/sources/sec-adv/adv-schedule-d.parser.ts`

```ts
export const SEC_ADV_FUNDS = 'SEC_ADV_FUNDS';

/** Schedule D 7.B.(1) `Fund Type` → the shared vocabulary. Exhaustive over the
 *  seven values observed across all 95,538 rows; anything unrecognised is
 *  'Other', never dropped and never guessed at. */
const ADV_FUND_TYPES: Record<string, FundStrategy> = {
  'Venture Capital Fund': 'Venture capital',
  'Private Equity Fund': 'Private equity',
  'Hedge Fund': 'Hedge fund',
  'Real Estate Fund': 'Real estate',
  'Securitized Asset Fund': 'Securitized asset',
  'Liquidity Fund': 'Liquidity',
  'Other Private Fund': 'Other',
};

export function fundStrategyForAdv(fundType: string | undefined): FundStrategy;
export function mapScheduleDRow(row: CsvRow, crd: string): NormalizedFund | null;
```

`mapScheduleDRow` drops rows with no `Fund Name`, title-cases it with
`titleCaseFirm` (which preserves the roman numerals that distinguish vintages),
reads `Gross Asset Value` through the existing `num()` helper — reusing
`adv.parser.ts`'s handling of `.00` for "nothing reported" — and writes
`grossAssetsUsd: null` rather than 0 when nothing was reported. `hq` is
`[State, Country]` joined, since Schedule D gives no city.

#### 4. Source

**New file**: `apps/jobs/src/sources/sec-adv/sec-adv-funds.source.ts`

The source needs the set of known manager CRDs *before* it reads anything —
without it, `IA_ADV_Base_A` would have to be held as ~1.5M `FilingID → CRD`
entries instead of ~15k. It must not query Prisma itself, though: every other
source is a pure fetcher and `IngestService` owns all database access.

So `FetchOptions` gains one optional field, which sources that don't need it
ignore exactly as they already ignore `days`:

```ts
export interface FetchOptions {
  days: number;
  limit: number;
  /** CRDs of investor firms already in the database. A fund-producing source
   *  uses it to discard filings by managers we don't hold, before they cost
   *  any memory. Absent for sources that produce no funds. */
  knownManagerCrds?: ReadonlySet<string>;
}
```

`IngestService.run` builds `FundIndex.investorByCrd` before the source loop and
passes its key set through.

`fetchFunds()` then:

1. Resolve the archive pair (or bail).
2. For each `(base, scheduleD)` pair — ERA base + ERA Schedule D in part1, IA
   base in part1 and IA Schedule D in part2:
   - stream the base file, keeping `FilingID → (crd, DateSubmitted)` **only for
     filings whose `1E1` is in `knownManagerCrds`**. This is what keeps the map
     at ~15k entries and is the reason a 533 MB member is affordable.
   - stream the Schedule D file, resolving each row's `FilingID`; keep the row
     with the newest `DateSubmitted` per `Fund ID`, falling back to
     `${crd}|${lowercased name}` when `Fund ID` is blank.
3. Emit, respecting `opts.limit`. Log counts per file and the totals by strategy.

Both streams go through `createCsvParser` — the ADV CSVs contain embedded
newlines in quoted cells, so a line split is wrong.

#### 5. Wiring

- Register `AdvArchiveClient` + `SecAdvFundsSource` in
  `apps/jobs/src/ingest/ingest.module.ts:20` and add it to the
  `INGESTION_SOURCES` factory array.
- `apps/jobs/src/backfill.ts:28` — extend the documented source list.
- `Makefile:121` — extend the `SOURCE=` help line; add
  `ingest-funds` / `ingest-funds-prod` targets.
- `Makefile:143` (`ingest-all`) — **reorder**: `SEC_ADV` → `SEC_ADV_FUNDS` →
  `SEC_EDGAR` → `WIKIDATA` → `SEC_FORM_C` → `SBIR` → `SEC_S1`. Funds need their
  managers to exist, and Phase 3's Form D pass needs funds to exist. Same change
  in `docs/DATA_REBUILD.md`'s production block.
- `apps/jobs/.env.example` — `ADV_ARCHIVE=`.

### Success Criteria

#### Automated Verification:
- [x] `yarn workspace jobs test` passes, including new specs for
      `parseCentralDirectory` (against an `fflate.zipSync` fixture),
      `parseAdvArchives` (against a saved copy of the FOIA page, asserting the
      pre-2011 archive is excluded and the newest range wins), and
      `fundStrategyForAdv` / `mapScheduleDRow`
- [x] `yarn lint` and `yarn build` pass
- [ ] `make ingest SOURCE=SEC_ADV_FUNDS LIMIT=1000000 DAYS=1` exits 0
- [ ] `select count(*) from "Fund"` returns ≈ 95,000
- [ ] `select count(distinct "managerId") from "Fund"` returns ≈ 5,500
- [ ] Every row has a manager: `select count(*) from "Fund" where "managerId" is null` → 0
- [ ] Re-running the same command changes no counts (idempotent)

#### Manual Verification:
- [ ] The run logs the archive label and both URLs, so it is reproducible via
      `ADV_ARCHIVE=`
- [ ] a16z's funds are there and named:
      `select name, strategy, "grossAssetsUsd" from "Fund" f join "Investor" i on i.id=f."managerId" where i.slug='andreessen-horowitz' order by "grossAssetsUsd" desc limit 10;`
      → ~92 rows, top one ≈ $3.03bn
- [ ] Peak RSS of the jobs process stays under the 1536m container limit during
      the `IA_ADV_Base_A` pass (watch `docker stats`)
- [ ] Strategy distribution matches the spike (≈41k venture capital, ≈41k
      private equity)

**Implementation Note**: pause here for confirmation before Phase 3.

---

## Phase 3: Pooled Form D → vintage, target and capital closed

### Overview

Stop discarding 63% of every Form D we fetch. The filings are already downloaded
and parsed; this phase reads three more fields out of them and routes the pooled
ones to `Fund` instead of `/dev/null`.

### Changes Required

#### 1. Parser

**File**: `apps/jobs/src/sources/sec-edgar/form-d.parser.ts`

`ParsedFormD` gains:

```ts
/** Fund class from `investmentFundInfo.investmentFundType`, present only on
 *  pooled filings: Venture Capital Fund | Private Equity Fund | Hedge Fund |
 *  Other Investment Fund. A structured field, not a guess from the name. */
investmentFundType: string;
/** Target raise. NULL — not 0 — when the filing says "Indefinite", which 51–67%
 *  of pooled filings do. Zero would read as "they targeted nothing". */
totalOfferingUsd: number | null;
```

`parseFormD` (line 164) reads
`offering.industryGroup?.investmentFundInfo?.investmentFundType` and adds:

```ts
/** `totalOfferingAmount` is either a number or the literal "Indefinite".
 *  `num()` strips non-digits, so "Indefinite" would silently become 0. */
function offeringAmount(v: unknown): number | null {
  const raw = str(v);
  if (!raw || /indefinite/i.test(raw)) return null;
  const n = num(raw);
  return n > 0 ? n : null;
}
```

`amountSoldUsd` keeps its current behaviour for operating companies. Note it
currently falls back to `totalOfferingAmount` (line 182) — that fallback must
not be reached with "Indefinite", which it already isn't, since `num()` returns
0 and the `||` then yields 0. Leave the company path untouched; the fund path
reads `totalAmountSold` directly.

#### 2. Source

**File**: `apps/jobs/src/sources/sec-edgar/sec-edgar.source.ts`

The worker loop (line 40) currently does:

```ts
if (this.skipFunds && parsed.isPooledFund) { skippedFunds++; continue; }
```

It becomes: collect the fund, then continue.

```ts
/** Funds collected by the last `fetch`, drained by `fetchFunds`. Pooled Form D
 *  filings are ~63% of the feed; they are not operating companies (so they must
 *  stay out of `Company`, which INGEST_SKIP_FUNDS has always got right) but they
 *  ARE fund closes. Collecting them here costs nothing: the filing has already
 *  been fetched, rate-limited and parsed. */
private funds: NormalizedFund[] = [];

async fetchFunds(): Promise<NormalizedFund[]> {
  const out = this.funds;
  this.funds = [];
  return out;
}
```

and `toFund(ref, parsed)`:

```ts
{
  externalId: ref.cik,              // the fund's own filer CIK
  name: parsed.entityName,
  managerCrd: null,                 // Form D never names the manager
  strategy: fundStrategyForFormD(parsed.investmentFundType),
  vintageYear: parsed.yearOfInc || null,
  targetUsd: parsed.totalOfferingUsd,
  closedUsd: parsed.amountSoldUsd || null,
  hq: [parsed.city, parsed.state].filter(Boolean).join(', ') || null,
  cikNumber: ref.cik,
}
```

`INGEST_SKIP_FUNDS` keeps its exact current meaning — *keep pooled funds out of
`Company`* — and its default stays `true`. Its doc comment (line 22) is updated
to say the filings are now routed to `Fund` rather than dropped.

D/A amendments key on the fund's CIK, not the accession, so a re-filing updates
the fund in place — the same reasoning as the person keys on line 76.

#### 3. Strategy mapping

**File**: `apps/jobs/src/sources/sec-edgar/fund-strategy.ts` (new, with a spec)

```ts
/** Form D `investmentFundType` → the shared vocabulary. Four values, all
 *  observed in the sampled filings. "Other Investment Fund" is honestly
 *  'Other' — the filer declined the three specific boxes. */
const FORM_D_FUND_TYPES: Record<string, FundStrategy> = {
  'Venture Capital Fund': 'Venture capital',
  'Private Equity Fund': 'Private equity',
  'Hedge Fund': 'Hedge fund',
  'Other Investment Fund': 'Other',
};
```

#### 4. Resolution rule in `IngestService`

`upsertFund` step 3 (manager resolution) is where a Form D fund lives or dies:
it has no `managerCrd`, so a `byName` miss means no manager, so it is skipped
and counted. The run log distinguishes the two outcomes:

```
SEC_EDGAR: 3,412 pooled filings → 1,208 funds matched, 2,204 unmatched (no ADV fund of that name)
```

### Success Criteria

#### Automated Verification:
- [x] `yarn workspace jobs test` passes, with new `form-d.parser.spec` cases for
      `investmentFundType` and for `totalOfferingAmount = "Indefinite"` → `null`
      (asserting explicitly that it is not `0`)
- [x] `fund-strategy.spec` covers all four Form D values plus an unknown
- [x] `yarn lint` and `yarn build` pass
- [ ] `make ingest SOURCE=SEC_EDGAR DAYS=30 LIMIT=100000` exits 0
- [ ] `select count(*) from "Fund" where "vintageYear" is not null` is > 0
- [ ] No fund has `targetUsd = 0`:
      `select count(*) from "Fund" where "targetUsd" = 0` → 0
- [ ] `Company` count is unchanged by the run's pooled filings (no fund became
      a company)

#### Manual Verification:
- [ ] The run log shows the matched/unmatched split, and the match rate is in
      the 30–40% band the spike measured for the years the ADV archive covers
- [ ] Spot-check three matched funds against their EDGAR filings: vintage,
      amount sold and strategy agree with the primary document
- [ ] A `DAYS=30` run over 2026 filings shows a *low* match rate — expected,
      since the ADV archive stops at 2024-12-31 — and no crash

**Implementation Note**: pause here for confirmation before Phase 4.

---

## Phase 4: API, `/funds`, investor profile, citations, docs

### Overview

Expose it. Public reads return `APPROVED` funds only, same as every other table.

### Changes Required

#### 1. API — funds module

**New**: `apps/api/src/funds/{funds.module,funds.controller,funds.service,fund.mapper}.ts`
and `dto/list-funds.dto.ts`, modelled directly on `investors/`
(`investors.service.ts:39` is the template).

- `GET /funds` → `Paginated<FundSummary>`; `q` (name contains, insensitive),
  `strategy` (`@IsIn([...FUND_STRATEGIES])`), `manager` (investor slug), `sort`
  (`size` → `grossAssetsUsd desc nulls last`, `vintage` → `vintageYear desc
  nulls last`, `name`). Default sort `size`, because the SPV platforms would
  otherwise dominate every page.
- No `GET /funds/:id` and no sitemap route — there is no per-fund page.
- Register in `apps/api/src/app.module.ts:16`.

#### 2. API — investor profile

**File**: `apps/api/src/investors/investors.service.ts:74`

`findOne` also loads the manager's funds (top `FUND_PREVIEW = 12` by
`grossAssetsUsd desc nulls last`) plus a filtered `_count`, and the citations
attaching to those fund rows — reusing the `loadCitations` shape from
`companies.service.ts:178` (one `citation.findMany` over a bounded id list,
`include: { source: true }`).

**File**: `packages/api/src/domain/investor.ts`

```ts
export interface InvestorDetailResponse extends InvestorSummary {
  /** The largest funds we can name, by gross assets. */
  funds: Fund[];
  /** How many we can name — distinct from `fundCount`, which is what the firm
   *  told the SEC. a16z reports 119 and we can name 92; showing both is the
   *  honest thing. */
  namedFundCount: number;
  /** Citations attesting the fund rows above. */
  citations: Citation[];
}
```

`InvestorDetailResponse` stops being a bare alias of `InvestorSummary`; the
directory read is unchanged.

#### 3. Web

- **`apps/web/lib/data.ts`** — `getFunds(query)` → `Paginated<FundSummary>`,
  with the same try/catch-to-fallback shape as `getInvestors` (line 558). The
  offline fallback array gets three illustrative funds, consistent with the
  file's existing role.
- **`apps/web/lib/list-params.ts`** — `fundListQuery(sp)` beside
  `investorListQuery` (line 70).
- **`apps/web/app/funds/page.tsx` + `FundDirectory.tsx`** — a direct sibling of
  `investors/page.tsx` + `InvestorDirectory.tsx`: search input, strategy
  `Select`, sort `Select`, `Pagination`, URL-mirrored debounced state. Columns:
  Fund · Manager · Strategy · Vintage · Size. Money through `formatUsd`,
  vintage and size in `font-mono`; a null size renders `formatUsd(null)` →
  "Undisclosed", never a zero.
- **`apps/web/app/investors/[slug]/page.tsx`** — a `Funds` section between the
  metrics strip (line 87) and `Portfolio` (line 93):
  - `SectionHeader title="Funds"` with note
    `` `${namedFundCount} named of ${fundCount} reported` `` when both are known.
  - Rows: name, strategy `Badge`, vintage, size, and a `<Citation citations=…
    entityId={fund.id} />` marker — an uncited fund renders the muted em dash,
    which is the whole point of that component.
  - "All N funds →" links to `/funds?manager=<slug>` when
    `namedFundCount > FUND_PREVIEW`.
  - When `namedFundCount === 0` but `fundCount > 0`, an `EmptyState` saying the
    firm reports N funds to the SEC that the public filing archive does not yet
    name — the same honest-gap framing the empty portfolio state uses (line 134).
- **`apps/web/app/sitemap.ts:9`** — add `/funds` to `STATIC_PATHS`. No per-fund
  URLs.
- **`SiteHeader.tsx`** — add the `/funds` nav link.

#### 4. Citations

**File**: `apps/jobs/src/backfill-citations.ts`

A `walkFunds()` beside `walkInvestorFirms` (line 430). A fund can carry two
derivable documents and both are minted, because a fund row's facts genuinely
come from two places:

- `cikNumber` present → `filerFormDUrl(cik)`, `'SEC filing'`, reference the CIK.
  This attests vintage, target and closed size.
- `secFundId` present → `advFirmUrl(managerCrd)`, `'SEC filing'`, with the
  805 fund id as the citation's `note` (the manager's IAPD page is shared by all
  of that firm's funds, and `Source` deduplicates by URL, so the per-fund
  identifier belongs on the citation — the same reasoning as the SBIR contract
  number, line 605). This attests the manager link and gross assets.

A fund with neither is skipped and counted, as everywhere else. `walkFunds`
needs `Fund.managerId → Investor.crdNumber`, loaded once into a map alongside
the existing `loadCompanyProvenance`.

#### 5. Documentation

- **`docs/DATA_REBUILD.md`** — a `SEC_ADV_FUNDS` row in the source table; the
  reordered rebuild commands; a short section covering (a) that Schedule D gives
  no vintage or fund size and Form D supplies both, (b) that the archive is
  frozen at 2024-12-31 so recent fund closes wait for the next SEC cut, (c) that
  a pooled Form D with no matching ADV fund is skipped rather than attached to a
  guessed manager, with the 35.4%/0.8% measurement, and (d) that AngelList-style
  SPV platforms account for tens of thousands of rows, which is why fund lists
  sort by size.
- **`CLAUDE.md`** — `Fund` in the Database section; `SEC_ADV_FUNDS` in the Jobs
  section; `/funds` in Routes; `FundStrategy` in the vocabularies paragraph;
  a note that `CitableType` is now a superset of the reviewable types.

### Success Criteria

#### Automated Verification:
- [x] `yarn build` and `yarn lint` pass across all workspaces
- [x] `yarn workspace api test` passes, with a `funds.service.spec` covering the
      three sorts, the `strategy` filter, the `manager` filter, and that
      `PENDING` funds are excluded
- [ ] `curl 'localhost:3000/funds?sort=size&pageSize=5'` returns 5 items with a
      `total` in the ~95k range
- [ ] `curl 'localhost:3000/funds?strategy=Venture%20capital'` returns only
      venture funds; `?strategy=bogus` returns 400
- [ ] `curl localhost:3000/investors/andreessen-horowitz | jq '.namedFundCount, (.funds|length)'`
      → `92`, `12`
- [ ] `make backfill-citations` exits 0 and
      `select count(*) from "Citation" where "entityType"='fund'` is > 0
- [ ] Re-running `make backfill-citations` adds no rows

#### Manual Verification:
- [ ] `/funds` renders in the parchment-ledger style: mono numerals, no accent
      colour, sizes via `formatUsd`, filters mirror to the URL and survive a
      reload
- [ ] `/investors/andreessen-horowitz` shows "92 named of 119 reported" and the
      largest funds with `[SEC]` markers that resolve to real SEC pages
- [ ] An investor with `fundCount > 0` but no named funds shows the empty state,
      not an empty list
- [ ] A fund with no target size shows "Undisclosed", never `$0`
- [ ] Mobile: the `/funds` table collapses like `InvestorDirectory` does at
      820px and the page never scrolls horizontally
- [ ] Dark/light and small-screen check on the new investor-profile section

---

## Testing Strategy

### Unit tests (`yarn workspace jobs test`, `yarn workspace api test`)

- `zip-range.spec.ts` — `parseCentralDirectory` against a fixture archive built
  in-test with `fflate.zipSync`; multiple members; a name with non-ASCII bytes.
- `adv-archive.client.spec.ts` — `parseAdvArchives` against a saved copy of the
  FOIA page: the newest range wins, the pre-2011 archive is excluded, and a page
  with only one half of a pair yields nothing.
- `adv-schedule-d.parser.spec.ts` — all seven `Fund Type` values plus an
  unknown; `.00` and blank gross asset values → `null`, not `0`; a row with no
  fund name is dropped.
- `form-d.parser.spec.ts` — `investmentFundType` extraction; **`"Indefinite"` →
  `null` and explicitly not `0`**; a non-pooled filing yields no fund fields.
- `fund-strategy.spec.ts` — the four Form D values plus an unknown.
- `ingest.service.spec.ts` — `upsertFund`: own-key update; name-match enrichment
  filling only blanks; an ADV fund whose name matches a *different* manager's
  fund creating a new row rather than merging; a fund whose name is claimed by
  two managers matching neither; a fund with no CRD and no name match being
  skipped rather than written with a null manager.
- `funds.service.spec.ts` — sorts, filters, `PENDING` exclusion, pagination.

### Integration

`apps/api/test/` — a funds e2e alongside the existing moderation spec: seed a
manager and three funds, assert `/funds` paging, filtering and that a `PENDING`
fund never appears.

### Manual testing steps

1. `make db-migrate && make ingest SOURCE=SEC_ADV LIMIT=1000000 DAYS=1`
2. `make ingest SOURCE=SEC_ADV_FUNDS LIMIT=1000000 DAYS=1` — watch `docker stats`
   through the `IA_ADV_Base_A` pass; confirm ~95k funds and a16z's 92.
3. `make ingest SOURCE=SEC_EDGAR DAYS=1825 LIMIT=200000` — confirm the
   matched/unmatched log line and that vintages appear.
4. `make backfill-citations`
5. `yarn dev`; walk `/funds`, its filters, `/investors/andreessen-horowitz`, and
   follow three citation markers to the SEC.
6. Re-run steps 2–4 and confirm every count is stable.

## Performance Considerations

- **Network**: ~180 MB per `SEC_ADV_FUNDS` run, in four range requests, throttled
  to the shared ≤6 req/s SEC budget. Comparable to SBIR's 91 MB and far below the
  1.1 GB a naive full-archive download would cost.
- **Memory**: the `IA_ADV_Base_A` member is 533 MB uncompressed and is never
  held — it streams through `createCsvParser` and only rows whose CRD is a known
  manager are retained (~15k of ~1.5M filings). Peak retained state is the
  ~95k-entry fund accumulator, which is the same order as the SBIR source's
  per-firm aggregation the worker already handles at `mem_limit: 1536m`.
- **Write volume**: ~95k `Fund` upserts, one round-trip each, matching the
  existing per-row pattern in `upsert`/`upsertInvestorFirm`. At the observed
  rate for 35k companies this is a few minutes; a `% 1000` progress log keeps it
  legible. Batching is deliberately not introduced here — it would be the first
  place in `IngestService` to do so, and it belongs in its own change.
- **Reads**: `/funds` sorts on `grossAssetsUsd` / `vintageYear` / `name`, each
  covered by a `(moderationStatus, …)` composite index. The investor profile's
  fund query is covered by `@@index([managerId])`.

## Migration Notes

- One additive migration, `add_fund_entity`. No data step, no backfill: `Fund`
  starts empty and is filled by ingest.
- Nothing existing changes shape. `Investor.fundCount` and `assetsUsd` stay —
  they are the firm's own SEC-reported rollup and remain the honest denominator
  against which "how many can we name" is read.
- `CitableType` widens; `ReviewableType` does not, so `countsByType`,
  `moderate()` and the admin UI are untouched.
- The reordering of `make ingest-all` is behaviour-affecting for a from-scratch
  rebuild: run the investor universe and funds before the long Form D walk, or
  the Form D pass has no funds to match against and contributes no vintages.
- Rollback is `prisma migrate resolve` plus dropping the table; no other table
  gains a column, so nothing else has to be undone.

## References

- Original ticket: `thoughts/shared/tickets/2026-08-16-fund-entity.md`
- Investor entity + ADV ingestion: `thoughts/shared/plans/2026-08-02-investor-entity-and-adv-ingestion.md`
- Form C / SBIR / S-1 (the snapshot-source and streaming-CSV precedents):
  `thoughts/shared/plans/2026-08-29-form-c-sbir-s1-ingestion.md`
- Snapshot source template: `apps/jobs/src/sources/sec-adv/sec-adv.source.ts:47`
- Index-page scraping precedent: `apps/jobs/src/sources/sec-adv/adv.client.ts:144`
- Streaming CSV: `apps/jobs/src/util/csv.ts:39`
- Match-and-enrich rules: `apps/jobs/src/ingest/ingest.service.ts:378`
- `onlyIfKnown` precedent: `apps/jobs/src/sources/ingestion-source.ts:41`
- Citation minting: `apps/jobs/src/backfill-citations.ts:430`
- Directory page pattern: `apps/web/app/investors/InvestorDirectory.tsx`
