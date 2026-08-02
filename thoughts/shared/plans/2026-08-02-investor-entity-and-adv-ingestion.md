# Investor Entity + SEC Form ADV Ingestion Implementation Plan

## Overview

Promote "investor" from a derived string-grouping to a first-class entity, and feed it from two
new/reworked ingestion paths: a rewritten Wikidata investor pass (class-whitelisted, EIB-free) and a
new `SEC_ADV` source that ingests the SEC's Investment Adviser bulk data — ~7,000 real VC/PE firms
with HQ, website, fund counts and gross fund assets.

## Current State Analysis

Investors have **no identity anywhere in the stack**. They exist only as free-text `name`/`type`
strings on `InvestorHolding` rows hung off a company (`schema.prisma:181-205`), plus an unrelated
free-text `RoundInvestor.name` on rounds (`schema.prisma:171-179`). The public `/investors` page is a
runtime `groupBy` over `InvestorHolding.name` (`apps/api/src/investors/investors.service.ts:49-129`)
— no id, no slug, no detail route, no link between the directory row and the investor block on a
company profile.

Live production data (queried 2026-08-02):

| metric | value |
|---|---|
| companies | 11,056 (4,784 SEC_EDGAR · 6,263 WIKIDATA) |
| funding rounds | 5,286 |
| `InvestorHolding` rows | 6,730 |
| **distinct investor names** | **772** |
| `RoundInvestor` rows | 17 (all human-contributed) |

Two data-quality failures dominate:

1. **83% of all holdings are one row: European Investment Bank** (5,583 of 6,730). The Wikidata
   source seeds off `?company wdt:P1951 ?investor` (`wikidata.queries.ts:28-30`), and P1951 is
   dominated by EIB *loan* recipients, which are not equity investors.
2. **6,725 of 6,730 holdings are typed `Venture`**, because `investorTypeFor`
   (`wikidata.mapper.ts:140-144`) is a two-line name regex that defaults everything to `Venture`.

SEC EDGAR contributes **zero** investors: `SecEdgarSource.toRecord` (`sec-edgar.source.ts:68-106`)
never populates `NormalizedRecord.investors`, because Form D structurally has no "who invested"
field — it discloses the issuer and its own officers/directors only.

### Key Discoveries

**Verified by direct query/download during research — these are measured, not estimated.**

- **SEC Form ADV bulk data is the single biggest available win.** Downloaded and inspected both
  monthly files:
  - `ia07012026-exempt.zip` → 6,535 Exempt Reporting Advisers (where most VCs sit), of which
    **2,671 report VC funds**, 1,918 PE funds.
  - `ia07012026.zip` → 16,935 Registered Advisers, 507 with VC funds, 2,508 with PE funds.
  - Applying a max-of-fund-counts rule yields **10,256 classifiable firms — 2,972 Venture / 4,061
    Private equity / 3,223 Hedge fund — and 86% carry a website URL.**
  - Columns confirmed present (171 total): `Organization CRD#`, `CIK#`, `Primary Business Name`,
    `Legal Name`, `Main Office City/State/Country`, `Website Address`, `Any VC Funds`,
    `Total number of VC funds`, `Any PE Funds`, `Total number of PE funds`, `Any Hedge Funds`,
    `Total number of Hedge funds`, `Total Gross Assets of Private Funds`, `SEC Current Status`.
  - Sanity check: `ANDREESSEN HOROWITZ` → 106 VC funds / $106.5B gross assets, `LIGHTSPEED VENTURE
    PARTNERS` → 51 / $50.0B, `GENERAL CATALYST` → 44 / $49.1B.
  - Overlap with our existing 772 investor names is only **10.2% (79 firms)** — ADV is almost
    entirely additive.
  - It does **not** contain per-fund Schedule D 7.B(1) detail (individual fund names/GAV) — only the
    firm-level rollup. That rollup is exactly what we need; do not plan on per-fund records.
- **The ADV download URLs are not pattern-stable.** Observed on one page:
  `ia07012026.zip`, `ia060126_0.zip`, `ia020226-exemptzip.zip`. The client **must scrape the landing
  page for `.zip` hrefs**, never construct a URL from a date.
- **ADV is a monthly full snapshot**, not a time-windowed feed — `FetchOptions.days` is meaningless
  for it; only `limit` applies.
- **Wikidata investor classes, live counts (2026-08-02):** `Q3487908` venture capital firm **312**,
  `Q1132207` business incubator **88**, `Q5418962` private equity firm **82**, `Q1061648` sovereign
  wealth fund **63**, `Q4086495` startup accelerator **57**, `Q105611` hedge fund **38**. That is
  ~640 firms enumerable by class before touching P1951.
- **EIB cannot be filtered by class.** `wd:Q192247` is `instance of` international financial
  institution (`Q1345691`) and EU institution (`Q4936585`) — it is *not* tagged `development bank`,
  so a "development bank" exclusion misses it. It needs an explicit QID exclusion. Verified:
  excluding that one QID drops P1951 edges from 7,077 to **1,492**.
- **AUM property is `P4103`**, not `P2403` (verified: Sequoia Capital → $53.3B/$85B). Crunchbase org
  ID is `P2088`.
- **No free source provides investor→portfolio-company edges at scale.** Neither Form D (either
  side) nor Form ADV names portfolio companies; this is a structural gap in US regulatory
  disclosure, not a parsing problem. Wikidata's 1,492 edges are the realistic ceiling for automated
  edges. Everything beyond that is crowdsourced — which the plan leans into rather than hides.
- Ingestion conventions to follow: sources implement `IngestionSource`
  (`ingestion-source.ts:99-102`) and are registered in the `INGESTION_SOURCES` factory
  (`ingest.module.ts:20-24`); all ingested rows are written `moderationStatus: 'APPROVED'`
  (`ingest.service.ts:169`); `normalizeName` (`ingest.service.ts:329-339`) is the existing dedupe
  key; `backfill.ts:11-30` is the CLI template; specs mock Prisma as a hand-rolled `jest.fn()` object
  (`ingest.service.spec.ts:32-52`).
- Seed rule (CLAUDE.md): **never edit a shipped phase.** Highest existing is `002-demo-companies`,
  which creates nested `InvestorHolding` rows — so `InvestorHolding.investorId` must be **nullable**
  or that phase breaks on a fresh DB.

### Decisions taken (confirmed with the user)

1. **Full scope** — `Investor` table + both sources + `/investors/[slug]` detail pages.
2. **Firms with no known portfolio are shown**, with an empty state inviting contribution.
3. **The 5,583 EIB holdings are deleted in the migration**, and the QID is excluded going forward.

## Desired End State

- A first-class `Investor` table holding ~8,000 firms (≈7,000 from ADV + ~640 Wikidata classes +
  ~770 existing names, less overlap), each with slug, type, HQ, website, and — where ADV supplied it
  — fund counts and gross fund assets.
- `/investors` lists real rows with working links; `/investors/[slug]` renders a profile with the
  firm's facts and its known portfolio, or an empty state that invites contribution.
- Zero EIB rows; investor `type` distribution reflects real structure instead of 99.9% `Venture`.
- `make ingest SOURCE=SEC_ADV` and `SOURCE=WIKIDATA` both populate investors idempotently.

Verify with: `docker exec capbase-postgres psql -U capbase -d capbase -c 'select type, count(*) from
"Investor" group by type;'` showing a spread across Venture/Private equity/Hedge fund/Accelerator,
and `select count(*) from "InvestorHolding" where name = 'European Investment Bank';` returning 0.

## What We're NOT Doing

- **Not** attempting automated investor→company edges from SEC data. Form D and Form ADV do not
  contain them. Do not let a later phase quietly re-scope into this.
- **Not** building news/press-release NLP (GDELT, Common Crawl, RSS). Both research agents
  independently flagged this as a multi-month relation-extraction project with uncertain precision.
- **Not** ingesting Crunchbase (ToS forbids redistribution outright), OpenVC (CC BY-NC-ND), or
  scraping YC/Techstars portfolio pages (licensing unresolved).
- **Not** ingesting per-fund vehicle records (fund vintages, individual fund GAV) — not present in
  the bulk ADV files.
- **Not** touching 13F/13D/13G/Form 4/Form C/Reg A+ — public-equity or retail-crowdfunding scoped.
- **Not** making `InvestorHolding.investorId` required — seed phase `002` is shipped and immutable.
- **Not** changing how `RoundInvestor` is written by the contribution flow; it only gains an optional
  link column for future use.

## Implementation Approach

Five phases, ordered so each is independently shippable and verifiable. Phase 1 is a pure data-quality
fix inside the existing schema and delivers value on its own. Phase 2 adds the table and does the
destructive cleanup once. Phase 3 teaches the ingest service to write investors. Phase 4 adds the big
new source. Phase 5 exposes it.

---

## Phase 1: Fix the Wikidata investor pass (no schema change)

### Overview
Replace the "harvest every P1951 object" approach with class-whitelisted enumeration plus a filtered
edge sweep, and derive investor type from `P31` structure instead of a name regex. This alone removes
the 83% EIB pollution and fixes the type distribution.

### Changes Required:

#### 1. Extend the investor vocabulary
**File**: `packages/api/src/domain/company.ts:76-84`
**Changes**: Add three types the sources can actually distinguish structurally.

```ts
export type InvestorType =
  | 'Venture'
  | 'Growth'
  | 'Angel'
  | 'Corporate'
  | 'Private equity'
  | 'Accelerator'
  | 'Hedge fund'
  | 'Sovereign wealth';

export const INVESTOR_TYPES: readonly InvestorType[] = [
  'Venture',
  'Growth',
  'Angel',
  'Corporate',
  'Private equity',
  'Accelerator',
  'Hedge fund',
  'Sovereign wealth',
];
```

`ListInvestorsDto` (`apps/api/src/investors/dto/list-investors.dto.ts`), `CreateInvestorDto`
(`apps/api/src/companies/dto/contributions.dto.ts:90-113`) and `lib/validation/investor.ts` all
validate via `@IsIn(INVESTOR_TYPES)` / the exported array, so they pick this up with no edit. The web
type filter renders from `INVESTOR_TYPES` and gains the options automatically.

#### 2. New investor-class map
**File**: `apps/jobs/src/sources/wikidata/investor-class-map.ts` (new)
**Changes**: Deterministic QID→type map, modelled on `sec-edgar/sector-map.ts`.

```ts
import type { InvestorType } from '@repo/api';

/** Wikidata P31 classes that identify an investor firm, mapped to our vocabulary.
 *  Counts as of 2026-08-02: VC 312, incubator 88, PE 82, SWF 63, accelerator 57, hedge 38. */
export const INVESTOR_CLASSES: Readonly<Record<string, InvestorType>> = {
  Q3487908: 'Venture',          // venture capital firm
  Q5418962: 'Private equity',   // private equity firm
  Q4086495: 'Accelerator',      // startup accelerator
  Q1132207: 'Accelerator',      // business incubator
  Q105611: 'Hedge fund',        // hedge fund
  Q1061648: 'Sovereign wealth', // sovereign wealth fund
  Q5: 'Angel',                  // human — an individual investor
};

/** Ordered by specificity: a firm carrying several classes takes the first match. */
const PRECEDENCE = ['Q3487908', 'Q5418962', 'Q4086495', 'Q1132207', 'Q105611', 'Q1061648', 'Q5'];

export function investorTypeForClasses(qids: readonly string[]): InvestorType | null {
  for (const qid of PRECEDENCE) if (qids.includes(qid)) return INVESTOR_CLASSES[qid]!;
  return null;
}

/** Entities that are lenders/state bodies, not equity investors. EIB (Q192247) must be
 *  excluded by QID: it is instance-of `international financial institution`/`EU institution`,
 *  NOT `development bank`, so a class filter alone does not catch it. It accounts for
 *  5,583 of the 6,730 holdings currently in the database. */
export const EXCLUDED_INVESTOR_QIDS: readonly string[] = ['Q192247'];

export const EXCLUDED_INVESTOR_CLASSES: readonly string[] = [
  'Q1345691', // international financial institution
  'Q4936585', // EU institution
  'Q327333',  // government agency
  'Q484652',  // international organization
  'Q5266746', // development bank
];
```

#### 3. New/changed SPARQL
**File**: `apps/jobs/src/sources/wikidata/wikidata.queries.ts`
**Changes**: Add investor-firm enumeration + profile queries; filter the existing edge query.

```ts
/** Every entity whose P31 is one of the investor-firm classes (~640 today). */
export function investorFirmsQuery(): string {
  return `SELECT ?investor ?investorLabel ?class ?website ?inception ?hqLabel ?countryLabel ?aum ?linkedinId WHERE {
  VALUES ?class { wd:Q3487908 wd:Q5418962 wd:Q4086495 wd:Q1132207 wd:Q105611 wd:Q1061648 }
  ?investor wdt:P31 ?class .
  OPTIONAL { ?investor wdt:P856 ?website . }
  OPTIONAL { ?investor wdt:P571 ?inception . }
  OPTIONAL { ?investor wdt:P159 ?hq . }
  OPTIONAL { ?investor wdt:P17 ?country . }
  OPTIONAL { ?investor wdt:P4103 ?aum . }
  OPTIONAL { ?investor wdt:P4264 ?linkedinId . }
  ${LABEL_SERVICE}
}`;
}
```

Change `investorsQuery` (currently `wikidata.queries.ts:47-53`) to carry the investor's classes and
drop excluded entities, so the mapper can type them structurally:

```ts
export function investorsQuery(qids: string[]): string {
  return `SELECT ?company ?investor ?investorLabel ?class WHERE {
  ${values(qids)}
  ?company wdt:P1951 ?investor .
  OPTIONAL { ?investor wdt:P31 ?class . }
  FILTER (?investor NOT IN (${EXCLUDED_INVESTOR_QIDS.map((q) => `wd:${q}`).join(', ')}))
  FILTER NOT EXISTS {
    ?investor wdt:P31/wdt:P279* ?bad .
    VALUES ?bad { ${EXCLUDED_INVESTOR_CLASSES.map((q) => `wd:${q}`).join(' ')} }
  }
  ${LABEL_SERVICE}
}`;
}
```

Also drop `seedQuery`'s reliance on P1951 as the *company* seed — leave that as is for now (it still
selects companies worth enriching); only the investor half changes in this phase.

#### 4. Structural typing in the mapper
**File**: `apps/jobs/src/sources/wikidata/wikidata.mapper.ts:121-144`
**Changes**: Replace `investorTypeFor`'s name regex with the class map; collect the multiple `?class`
rows per investor before typing.

```ts
function mapInvestors(qid: string, rows: SparqlBinding[]): NormalizedInvestor[] {
  const classesByInvestor = new Map<string, { name: string; classes: string[] }>();
  for (const b of rows) {
    const invQid = qidOf(b.investor);
    const name = labelOf(b.investorLabel);
    if (!invQid || !name) continue;
    const entry = classesByInvestor.get(invQid) ?? { name, classes: [] };
    const cls = qidOf(b.class);
    if (cls && !entry.classes.includes(cls)) entry.classes.push(cls);
    classesByInvestor.set(invQid, entry);
  }

  const out: NormalizedInvestor[] = [];
  for (const [invQid, { name, classes }] of classesByInvestor) {
    out.push({
      externalId: `${qid}:investor:${invQid}`,
      investorExternalId: invQid,        // new: identity key for the Investor row (Phase 3)
      name,
      // Structural first; fall back to Venture only when Wikidata has no usable class.
      type: investorTypeForClasses(classes) ?? 'Venture',
      firstRound: 'Undisclosed',
      rounds: 1,
    });
  }
  return out;
}
```

Delete `investorTypeFor` (`wikidata.mapper.ts:140-144`).

#### 5. Carry the identity key on the DTO
**File**: `apps/jobs/src/sources/ingestion-source.ts:15-22`
**Changes**: Add the field Phase 3 needs; optional so nothing else breaks yet.

```ts
export interface NormalizedInvestor {
  externalId: string;
  /** Stable id of the INVESTOR itself within the source (Wikidata QID, ADV CRD).
   *  Distinct from `externalId`, which identifies this company↔investor holding. */
  investorExternalId?: string;
  name: string;
  type: InvestorType;
  firstRound: string;
  rounds: number;
}
```

#### 6. Tests
**File**: `apps/jobs/src/sources/wikidata/wikidata.mapper.spec.ts`, `wikidata.queries.spec.ts`
**Changes**: Assert EIB is excluded from generated SPARQL; assert `Q3487908`→`Venture`,
`Q4086495`→`Accelerator`, `Q5`→`Angel`, unknown/absent class→`Venture`; assert multi-class precedence.
New `investor-class-map.spec.ts` for the pure map.

### Success Criteria:

#### Automated Verification:
- [x] Unit tests pass: `yarn workspace jobs test` — 113 passed
- [x] Type checking + build passes: `yarn build`
- [x] Linting passes: `yarn lint`
- [x] Generated SPARQL excludes `wd:Q192247`: covered by `wikidata.queries.spec.ts`

#### Manual Verification:
- [ ] `make ingest DAYS=1 LIMIT=200 SOURCE=WIKIDATA` completes without SPARQL timeouts
- [ ] No new `InvestorHolding` rows named `European Investment Bank` are created by that run
- [ ] Investor types in newly-written rows show a real spread, not 100% `Venture`

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: `Investor` model, migration, and EIB purge

### Overview
Add the table, link the two existing investor-ish tables to it, backfill rows from the names we
already have, and delete the EIB pollution — one destructive step, done once, with a stated rollback.

### Changes Required:

#### 1. Schema
**File**: `packages/db/prisma/schema.prisma`
**Changes**: New model + two nullable FKs, following the provenance/moderation convention used by
every sibling model.

```prisma
model Investor {
  id          String  @id @default(cuid())
  slug        String  @unique
  name        String
  legalName   String?
  type        String
  hq          String?
  websiteUrl  String?
  linkedinUrl String?
  domain      String?
  description String?

  // ADV-derived facts (null for Wikidata/contributed rows).
  crdNumber       String?
  cikNumber       String?
  fundCount       Int?
  assetsUsd       BigInt?
  foundedYear     Int?

  externalSource String?
  externalId     String?

  moderationStatus ReviewStatus @default(PENDING)
  submittedById    String?
  submittedBy      User?        @relation(fields: [submittedById], references: [id], onDelete: SetNull)
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  holdings       InvestorHolding[]
  roundPositions RoundInvestor[]

  @@unique([externalSource, externalId])
  @@index([moderationStatus])
  @@index([moderationStatus, type])
  @@index([moderationStatus, name])
  @@index([domain])
}
```

On `InvestorHolding` (`schema.prisma:181-205`) add:

```prisma
  investorId String?
  investor   Investor? @relation(fields: [investorId], references: [id], onDelete: SetNull)
  // ...
  @@index([investorId])
```

On `RoundInvestor` (`schema.prisma:171-179`) add the same nullable `investorId`/`investor`/index.
Add `investors Investor[]` to the `User` model's relation list (`schema.prisma:42` area) to satisfy
the back-relation.

**`investorId` is deliberately nullable**: seed phase `002-demo-companies` is shipped and creates
`InvestorHolding` rows without it, and CLAUDE.md forbids editing a shipped phase. The invariant is
enforced in code instead — every new write path (ingest, contribution) populates it.

#### 2. Migration with data steps
**File**: `packages/db/prisma/migrations/<timestamp>_add_investor_entity/migration.sql`
**Changes**: Generate DDL with `--create-only`, then append the data steps below **in this order**
(purge first so we never mint an EIB investor row).

```sql
-- 1. Purge European Investment Bank holdings: an EU development lender whose P1951
--    statements are loan recipients, not equity investments. 5,583 rows, all with
--    WIKIDATA provenance — no human contributions are affected.
DELETE FROM "InvestorHolding"
WHERE name = 'European Investment Bank' AND "externalSource" = 'WIKIDATA';

-- 2. One Investor row per remaining distinct holding name. Type = most common type
--    for that name; slug = kebab(name) with a numeric suffix on collision.
INSERT INTO "Investor" (id, slug, name, type, "moderationStatus", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')
    || CASE WHEN row_number() OVER (
         PARTITION BY regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')
         ORDER BY name) = 1
       THEN '' ELSE '-' || row_number() OVER (
         PARTITION BY regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')
         ORDER BY name)::text END,
  name,
  (array_agg(type ORDER BY type))[1],
  'APPROVED',
  now(), now()
FROM "InvestorHolding"
GROUP BY name;

-- 3. Link existing holdings and round positions by exact name.
UPDATE "InvestorHolding" h SET "investorId" = i.id FROM "Investor" i WHERE i.name = h.name;
UPDATE "RoundInvestor" r SET "investorId" = i.id FROM "Investor" i WHERE i.name = r.name;
```

Note `gen_random_uuid()` requires `pgcrypto`/PG13+; the compose image satisfies this. The ids are
opaque strings so a uuid is compatible with the cuid-typed column.

**Rollback**: the migration is not reversible for the deleted EIB rows. They are reproducible by
re-running `make ingest SOURCE=WIKIDATA` against a pre-Phase-1 checkout, so no backup step is
required — but take a `pg_dump` before applying in production regardless.

#### 3. Shared types
**File**: `packages/api/src/domain/investor.ts`
**Changes**: Add the stored entity and detail response alongside the existing `InvestorSummary`.

```ts
/** A first-class investor firm. */
export interface Investor {
  slug: string;
  name: string;
  legalName?: string | null;
  type: InvestorType;
  hq?: string | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  domain?: string | null;
  description?: string | null;
  /** Number of private funds the firm reports (ADV-sourced). */
  fundCount?: number | null;
  /** Gross assets of those funds, USD (ADV-sourced). */
  assetsUsd?: number | null;
  foundedYear?: number | null;
}

export interface InvestorDetailResponse extends Investor {
  portfolioCount: number;
  sectors: string[];
  companies: { slug: string; name: string; domain: string }[];
}
```

Add `slug` to `InvestorSummary` (the directory now needs a link target) and keep the rest of its
shape so `InvestorDirectory.tsx` continues to compile.

#### 4. Seed phase
**File**: `packages/db/prisma/seeds/003-demo-investors.ts` (new), registered in
`packages/db/prisma/seeds/index.ts:9`
**Changes**: `kind: 'demo'`, idempotent upserts creating `Investor` rows for the demo companies'
holdings and setting `investorId`. Do not modify `002`.

### Success Criteria:

#### Automated Verification:
- [x] Migration applies cleanly: `make db-migrate`
- [x] Prisma client regenerates: `make db-generate`
- [x] Build + lint pass: `yarn build && yarn lint`
- [x] Seed runner applies phase 003 only: `make db-seed`
- [x] Fresh-database rebuild works end-to-end — verified against a scratch database
      (`make db-verify-fresh`) rather than `make db-reset`, which would have destroyed
      the 11k already-ingested companies.

#### Manual Verification:
- [ ] `select count(*) from "InvestorHolding" where name = 'European Investment Bank';` → 0
- [ ] `select count(*) from "Investor";` ≈ 771 (772 distinct names less EIB)
- [ ] `select count(*) from "InvestorHolding" where "investorId" is null;` → 0
- [ ] `/investors` still renders (it reads the old groupBy path until Phase 5)

**Implementation Note**: Pause for manual confirmation before proceeding — this is the destructive
phase.

---

## Phase 3: Teach `IngestService` to write investors

### Overview
Give the ingest service an investor identity path mirroring `upsertCompany`'s match-and-enrich
(`ingest.service.ts:218-299`), and a second entry point for sources that emit standalone firms with
no company attached (which is what ADV is).

### Changes Required:

#### 1. Standalone-firm DTO + optional source method
**File**: `apps/jobs/src/sources/ingestion-source.ts`
**Changes**:

```ts
/** An investor firm as an entity in its own right, with no company edge. */
export interface NormalizedInvestorFirm {
  /** Stable id within the source (ADV CRD number, Wikidata QID). */
  externalId: string;
  name: string;
  legalName?: string | null;
  type: InvestorType;
  hq?: string | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  description?: string | null;
  crdNumber?: string | null;
  cikNumber?: string | null;
  fundCount?: number | null;
  assetsUsd?: number | null;
  foundedYear?: number | null;
}

export interface IngestionSource {
  readonly name: string;
  fetch(opts: FetchOptions): Promise<NormalizedRecord[]>;
  /** Sources that publish an investor universe implement this too. */
  fetchInvestors?(opts: FetchOptions): Promise<NormalizedInvestorFirm[]>;
}
```

Keeping this on the same interface means one DI token, one `INGEST_SOURCES` env var, and no scheduler
change.

#### 2. Investor match index + upsert
**File**: `apps/jobs/src/ingest/ingest.service.ts`
**Changes**: Add an `InvestorIndex` loaded once per run (mirroring `loadMatchIndex`
at `ingest.service.ts:90-110`), keyed by provenance, domain and normalized name.

```ts
interface InvestorIndex {
  byKey: Map<string, string>;    // `${source}:${externalId}` → investor id
  byDomain: Map<string, string>; // website hostname → investor id
  byName: Map<string, string>;   // normalizeInvestorName(name) → investor id
  slugs: Set<string>;
}
```

`run()` gains a second loop after the record loop:

```ts
for (const source of active) {
  if (!source.fetchInvestors) continue;
  const firms = await source.fetchInvestors(opts);
  for (const firm of firms) {
    try {
      await this.upsertInvestor(firm, source.name, investorIndex);
      upsertedInvestors += 1;
    } catch (err) { /* same warn-and-continue shape as ingest.service.ts:73-78 */ }
  }
}
```

`upsertInvestor` resolves in the same precedence order as `upsertCompany`: own provenance key →
domain match → normalized-name match → create. On a match it **enriches only blank fields** and never
overwrites `name`, `type`, or human-written `description`.

Then extend the existing holdings loop (`ingest.service.ts:156-173`) to resolve/attach `investorId`,
creating a minimal `Investor` row when the holding names one we've not seen.

#### 3. Investor name normalization
**File**: `apps/jobs/src/ingest/ingest.service.ts`
**Changes**: A separate exported `normalizeInvestorName` — do **not** reuse `normalizeName`
(`ingest.service.ts:329-339`) unchanged, and do **not** strip business words.

```ts
const INVESTOR_LEGAL_SUFFIXES = new Set([
  ...LEGAL_SUFFIXES, 'lp', 'llp', 'gmbh', 'bv', 'ab', 'oy', 'pte', 'pty', 'as', 'nv', 'spa', 'srl',
]);

/** Investor dedupe key. Strips legal-form suffixes ONLY. Business words
 *  ('capital', 'partners', 'ventures', 'management') are meaning-bearing:
 *  "Greylock Partners" and "Greylock Capital Management" are different firms. */
export function normalizeInvestorName(name: string): string { /* … */ }
```

**Known hazard to guard, found in the real data**: ADV contains `SEQUOIA PLANNING & INVESTMENTS LLC`
and `BENCHMARK CAPITAL GROUP LTD.` (a Galena wealth manager) — false friends for the famous VC firms.
This is why domain matching takes precedence over name matching, and why nothing but blank fields is
ever enriched on a name-only match.

#### 4. Tests
**File**: `apps/jobs/src/ingest/ingest.service.spec.ts`
**Changes**: Add `prisma.investor.{findMany,create,update,upsert}` to `mockPrisma()`
(`ingest.service.spec.ts:32-52`). New cases: standalone firm creates an `Investor` with no holding;
a firm matching an existing investor by domain enriches rather than duplicating; a name-only match
does not overwrite `type`; a holding links to the right `investorId`; slug collisions get suffixed.
Table tests for `normalizeInvestorName`, explicitly including the Sequoia/Benchmark false friends.

### Success Criteria:

#### Automated Verification:
- [x] Unit tests pass: `yarn workspace jobs test` — 129 passed
- [x] Build + lint pass: `yarn build && yarn lint`

#### Manual Verification:
- [ ] `make ingest DAYS=1 LIMIT=200 SOURCE=WIKIDATA` re-run twice creates no duplicate `Investor` rows
- [ ] Every `InvestorHolding` written by that run has a non-null `investorId`

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: `SEC_ADV` ingestion source

### Overview
New source that downloads the two monthly SEC Investment Adviser bulk ZIPs, parses the firm roster
CSVs, and emits ~7,000 VC/PE firms via `fetchInvestors`.

### Changes Required:

#### 1. Client
**File**: `apps/jobs/src/sources/sec-adv/adv.client.ts` (new)
**Changes**: Scrape the landing page for `.zip` hrefs, pick the newest exempt + registered pair,
download, unzip in memory, return CSV text. Reuses the `SEC_USER_AGENT` + throttle conventions from
`edgar.client.ts:88-100`.

```ts
const ADV_INDEX_URL =
  'https://www.sec.gov/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers';

/** The published filenames are NOT pattern-stable — observed on one page:
 *  `ia07012026.zip`, `ia060126_0.zip`, `ia020226-exemptzip.zip`. Always scrape
 *  the page for hrefs; never construct a URL from a date. */
export function parseAdvLinks(html: string): { registered: string; exempt: string } { /* … */ }
```

The archives are small (registered 5.2MB → 42MB CSV; exempt 0.8MB → 6.5MB CSV), so an in-memory
unzip is fine — no streaming machinery needed.

#### 2. Parser
**File**: `apps/jobs/src/sources/sec-adv/adv.parser.ts` (new)
**Changes**: Pure CSV→`NormalizedInvestorFirm[]` mapper. **Read with latin-1, not utf-8** — the
files are not UTF-8. Header names are verbatim from the file (some contain embedded newlines, e.g.
`"Total number of offices\n other than your Principal Office…"`) so key on exact strings.

```ts
/** Firm type from the fund-count columns: whichever fund class it runs most of.
 *  Verified distribution across both files: 2,972 Venture / 4,061 Private equity /
 *  3,223 Hedge fund; 86% carry a website. */
export function investorTypeForAdv(row: AdvRow): InvestorType | null {
  const counts: [InvestorType, number][] = [
    ['Venture', num(row['Total number of VC funds'])],
    ['Private equity', num(row['Total number of PE funds'])],
    ['Hedge fund', num(row['Total number of Hedge funds'])],
  ];
  const [type, n] = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return n > 0 ? type : null;
}
```

Field mapping: `externalId` ← `Organization CRD#`; `name` ← `Primary Business Name` (title-cased —
the source is ALL CAPS); `legalName` ← `Legal Name`; `hq` ← city/state/country joined; `websiteUrl` ←
`Website Address` (normalize scheme/case, drop non-URLs — some rows hold an `x.com` or LinkedIn URL);
`crdNumber`, `cikNumber`; `fundCount` ← the winning type's count; `assetsUsd` ← `Total Gross Assets of
Private Funds` (strip commas, parse to BigInt-safe integer). Skip rows whose `SEC Current Status` is
not active.

#### 3. Source
**File**: `apps/jobs/src/sources/sec-adv/sec-adv.source.ts` (new)
**Changes**: `name = 'SEC_ADV'`; `fetch()` returns `[]` (no company records); `fetchInvestors()` does
the work, honouring `limit` and ignoring `days` (monthly snapshot — document this in a comment).
Types to ingest are configurable, defaulting to VC+PE so the directory leads with startup-relevant
firms:

```ts
// Hedge funds are opt-in: many are public-markets-only and would dilute the directory.
private readonly types = (process.env.ADV_INVESTOR_TYPES ?? 'Venture,Private equity').split(',');
```

#### 4. Wiring
**File**: `apps/jobs/src/ingest/ingest.module.ts:11-27`
**Changes**: Register `AdvClient` + `SecAdvSource` in `providers`, and add to the `INGESTION_SOURCES`
factory/inject arrays (lines 20-24).

**File**: `apps/jobs/.env.example`
**Changes**: Document `ADV_INVESTOR_TYPES`; note `SEC_ADV` as a valid `INGEST_SOURCES` value. Leave
the scheduler default as `SEC_EDGAR` — ADV is a monthly snapshot and belongs on a manual/monthly run,
not the daily cron.

**File**: `Makefile:84`
**Changes**: Update the `ingest` target's help text to list `SEC_ADV`.

#### 5. Wikidata investor firms
**File**: `apps/jobs/src/sources/wikidata/wikidata.source.ts`
**Changes**: Implement `fetchInvestors()` using `investorFirmsQuery()` from Phase 1, mapping the ~640
class-enumerated firms (with `P4103` AUM → `assetsUsd`, `P571` → `foundedYear`, `P159`/`P17` → `hq`).

#### 6. Tests
**File**: `apps/jobs/src/sources/sec-adv/adv.parser.spec.ts`, `adv.client.spec.ts` (new)
**Changes**: Pure-function specs in the `form-d.parser.spec.ts` style, with a small literal CSV
fixture covering: a VC firm, a PE firm, a firm with zero funds (skipped), a firm with a junk website
value, a latin-1 high byte in a name, and the embedded-newline header. `parseAdvLinks` against a
literal HTML fixture including the three inconsistent filename shapes.

### Success Criteria:

#### Automated Verification:
- [ ] Unit tests pass: `yarn workspace jobs test`
- [ ] Build + lint pass: `yarn build && yarn lint`

#### Manual Verification:
- [ ] `make ingest LIMIT=100000 SOURCE=SEC_ADV` completes; log reports ~7,000 firms upserted
- [ ] `select type, count(*) from "Investor" group by type;` shows Venture and Private equity in the
      thousands
- [ ] Spot-check: `Andreessen Horowitz` has one row (not duplicated against the Wikidata-sourced
      one), with `fundCount` 106 and `assetsUsd` ≈ 106,486,870,258
- [ ] Re-running the same command creates no duplicates
- [ ] `SEQUOIA PLANNING & INVESTMENTS LLC` did **not** merge into `Sequoia Capital`

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: API + web surface

### Overview
Serve investors from the real table, add the detail route, and link the directory rows.

### Changes Required:

#### 1. Service rewrite
**File**: `apps/api/src/investors/investors.service.ts:49-129`
**Changes**: Replace the three-query `groupBy`/`Accumulator`/`mode()` machinery with a direct
`investor.findMany`, using a filtered relation count so `portfolioCount` still counts only approved
holdings on approved companies:

```ts
const where: Prisma.InvestorWhereInput = {
  moderationStatus: 'APPROVED',
  ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
  ...(query.type && { type: query.type }),
};

const [total, rows] = await this.prisma.$transaction([
  this.prisma.investor.count({ where }),
  this.prisma.investor.findMany({
    where,
    orderBy: query.sort === 'name' ? [{ name: 'asc' }] : [{ holdings: { _count: 'desc' } }, { name: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      holdings: {
        where: { moderationStatus: 'APPROVED', company: { moderationStatus: 'APPROVED' } },
        take: PORTFOLIO_SAMPLE,
        include: { company: { select: { slug: true, name: true, domain: true, primarySector: true } } },
      },
      _count: { select: { holdings: { where: { moderationStatus: 'APPROVED', company: { moderationStatus: 'APPROVED' } } } } },
    },
  }),
]);
```

Add `findOne(slug)` returning `InvestorDetailResponse` (404 via `NotFoundException` when absent or
not approved), loading the full approved portfolio rather than a sample.

Per the confirmed decision, firms with zero holdings **are** returned — no `holdings: { some: {} }`
filter.

#### 2. Controller + mapper
**File**: `apps/api/src/investors/investors.controller.ts`
**Changes**: Add `@Get(':slug')`. Add `@Get('sitemap')` **declared before** `:slug`, matching the
ordering comment at `companies.controller.ts:31`.
**File**: `apps/api/src/investors/investor.mapper.ts` (new) — `toInvestor`/`toInvestorSummary` pure
mappers in the `company.mapper.ts` style, converting `assetsUsd` BigInt→number.

#### 3. Contribution + moderation paths
**File**: `apps/api/src/companies/companies.service.ts:228-244`
**Changes**: `addInvestor` find-or-creates the linked `Investor` (matching on
`normalizeInvestorName`) instead of a bare `investorHolding.create`, so contributed holdings also
carry `investorId`. The new `Investor` row is created `PENDING` when it comes from a contribution.
**File**: `apps/api/src/admin/admin.service.ts:155-160`
**Changes**: The `'investor'` moderation branch continues to act on `InvestorHolding`; approving a
holding also flips its parent `Investor` to `APPROVED` if still `PENDING`.

#### 4. Web
**Files**:
- `apps/web/lib/data.ts:479-488` — add `getInvestor(slug)`; update the fallback mock array to carry
  `slug`.
- `apps/web/app/investors/[slug]/page.tsx` (new) — profile built from existing primitives
  (`PageContainer`, `SectionHeader`, `Stat`, `Card`, `Badge`, `EmptyState`). Facts row: type, HQ,
  fund count, gross fund assets (via `formatUsd`), website/LinkedIn outbound links. Portfolio grid
  reusing `CompanyLogo`. **Empty state when `portfolioCount === 0`**: an `EmptyState` inviting a
  contribution — this is the majority case for ADV firms and is the confirmed intended behaviour.
- `apps/web/app/investors/InvestorDirectory.tsx:157-184` — wrap each row in a link to
  `/investors/[slug]`; render `— no known investments yet` where `portfolioCount === 0`.
- `apps/web/app/companies/[slug]/page.tsx:179-206` — link each investor card to its detail page when
  the holding has a linked investor, keeping the outbound website link as a secondary action.
- `apps/web/app/sitemap.ts` — include investor slugs.

All monochrome per the design system; numbers through `lib/format.ts`; no new CSS Modules.

### Success Criteria:

#### Automated Verification:
- [ ] API tests pass: `yarn workspace api test`
- [ ] Build + lint pass across the monorepo: `yarn build && yarn lint`
- [ ] `curl 'localhost:3000/investors?pageSize=5'` returns items carrying `slug`
- [ ] `curl localhost:3000/investors/andreessen-horowitz` returns 200 with `portfolioCount`
- [ ] Unknown slug returns 404: `curl -o /dev/null -w '%{http_code}' localhost:3000/investors/nope`

#### Manual Verification:
- [ ] `/investors` rows link through; pagination, `q`, `type` and `sort` still work from the URL
- [ ] A firm with no portfolio renders the contribute empty state, not a broken/blank panel
- [ ] A firm with a portfolio shows logos and links back to company profiles
- [ ] Investor cards on a company profile link to the investor page
- [ ] Page is monochrome and holds the parchment-ledger system (mono numerals for assets/counts)

---

## Testing Strategy

### Unit Tests:
- `investor-class-map.spec.ts` — QID→type precedence, exclusions.
- `wikidata.queries.spec.ts` — EIB QID and excluded classes present in generated SPARQL.
- `wikidata.mapper.spec.ts` — structural typing, multi-class investors, missing-class fallback.
- `adv.parser.spec.ts` — type derivation, latin-1 decoding, embedded-newline headers, junk websites,
  inactive-status skip, money parsing with thousands separators.
- `adv.client.spec.ts` — `parseAdvLinks` against the three observed filename shapes.
- `ingest.service.spec.ts` — standalone-firm creation, domain-precedence matching, no-overwrite
  enrichment, holding→investor linking, slug collisions, `normalizeInvestorName` false friends.
- `investors.service.spec.ts` — pagination, filtering, sort, filtered `_count`, zero-portfolio firms
  included, `findOne` 404.

### Integration Tests:
- Idempotency: run `make ingest SOURCE=SEC_ADV` twice, assert `Investor` count is unchanged.
- Cross-source identity: run `WIKIDATA` then `SEC_ADV`; assert a firm present in both (Andreessen
  Horowitz) has exactly one row.

### Manual Testing Steps:
1. `make db-reset && make db-migrate` — clean schema with the new model.
2. `make ingest DAYS=1 LIMIT=500 SOURCE=WIKIDATA` — investors typed structurally, zero EIB.
3. `make ingest LIMIT=100000 SOURCE=SEC_ADV` — ~7,000 firms.
4. `make dev`, visit `/investors` — filter by `Private equity`, sort by name, paginate.
5. Open a zero-portfolio firm and confirm the contribute empty state.
6. Open `/investors/andreessen-horowitz` and confirm facts + portfolio render.
7. Contribute an investor from a company profile; confirm it appears in `/admin` and links correctly
   once approved.

## Performance Considerations

- The old `findAll` ran an **unpaged** `groupBy` purely to compute `total`
  (`investors.service.ts:62`, flagged in its own comment). Phase 5 replaces it with `investor.count`
  — a real index scan — which matters once the table is ~8,000 rows instead of 772.
- `orderBy: { holdings: { _count: 'desc' } }` sorts on a relation aggregate; if it degrades at scale,
  denormalize a `portfolioCount` column updated by the ingest run. Not needed at 8k rows.
- The 42MB registered-adviser CSV is parsed in memory once per ADV run. Acceptable for a monthly
  job in a container; if memory is constrained, switch to a streaming CSV reader.
- ADV runs monthly, not on the daily cron — keep it off `INGEST_SOURCES`' default.
- `loadInvestorIndex` loads all investors once per run, mirroring `loadMatchIndex`'s existing
  approach for 11k companies. Fine at this scale.

## Migration Notes

- Phase 2 deletes 5,583 EIB holdings. All carry `WIKIDATA` provenance; no human contributions are
  affected. Take a `pg_dump` before applying in production.
- `investorId` is nullable by design (shipped seed phase `002` cannot be edited). Code enforces the
  invariant on every new write path.
- Existing `/investors` URLs are unaffected — the list route keeps its path and query params; only
  the backing query changes.
- Adding to `INVESTOR_TYPES` is additive; no stored value becomes invalid.

## References

- Research (this session): SEC ADV bulk files downloaded and inspected 2026-08-02; Wikidata class
  counts and P1951 edge counts queried live against `query.wikidata.org/sparql`.
- SEC Form ADV bulk data: https://www.sec.gov/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers
- SEC Form D quarterly data sets: https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets
- Prior plan: `thoughts/shared/plans/2026-07-15-job-scraper-backfill-and-enrichment.md`
- Ingestion contract: `apps/jobs/src/sources/ingestion-source.ts:99-102`
- Match-and-enrich pattern to mirror: `apps/jobs/src/ingest/ingest.service.ts:218-299`
- Deterministic classification precedent: `apps/jobs/src/sources/sec-edgar/sector-map.ts`
- CLI template: `apps/jobs/src/backfill.ts:11-30`
