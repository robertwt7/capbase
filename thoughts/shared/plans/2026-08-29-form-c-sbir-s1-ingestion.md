# Form C, SBIR and S-1 ingestion Implementation Plan

## Overview

Add three ingestion sources behind the existing `IngestionSource` contract:
**SEC Form C** (Reg CF crowdfunding offerings), **SBIR/STTR awards** (US
non-dilutive deep-tech funding) and **SEC Form S-1** (principal-stockholder
tables, the first automatable investor→company edge set at scale).

The first two are bulk snapshots that behave like `SEC_ADV` — they ignore
`days`, stay off the daily cron, and run from `make ingest SOURCE=…`. The third
is a document walker with a real HTML parser and a per-row confidence score, and
lands last.

One schema change makes the rest honest: `FundingRound.kind`
(`Equity | Debt | Grant`), because an SBIR award is a real capital event but not
a dilutive raise, and the market tape must not silently absorb $60bn of federal
grants.

## Current State Analysis

Three sources exist today (`apps/jobs/src/sources/`):

| Source | Shape | Produces |
|---|---|---|
| `SEC_EDGAR` | daily index walk | companies + rounds + people |
| `WIKIDATA` | SPARQL snapshot | company metadata, investors, people, acquisitions, exits, ~640 firms |
| `SEC_ADV` | monthly bulk ZIP | investor firms only |

Live corpus (local DB, 2026-08-29):

```
companies 11290   rounds 5536   investors 7474
holdings   1157   people 15595   citations 39069 / sources 23027
```

`SEC_ADV` (`sources/sec-adv/sec-adv.source.ts:47`) is the template for a
snapshot source: `fetch()` returns `[]` or a full set, `days` is documented as
ignored, and the client scrapes an index page rather than constructing URLs.

**The constraint that shapes everything: only 531 of 11,290 companies carry a
domain.** `IngestService.upsertCompany` (`ingest/ingest.service.ts:432`) matches
`byKey → byDomain → byName`, so in practice almost every cross-source match today
falls through to `normalizeName`. Any new source that ships domains is
strictly better off than what we have.

### What the ticket gets right, and the three places it does not

I pulled all three source datasets before planning. Corrections:

1. **Form C does not publish the amount raised as a field.** The DERA data sets
   ship `OFFERINGAMOUNT` (target) and `MAXIMUMOFFERINGAMOUNT` only; proceeds
   appear as free text in `PROGRESSUPDATE` on `C-U` filings
   (*"has raised a total of $396,500."*). Real, but a text parser.
2. **The SBIR JSON API is unusable.** `api.www.sbir.gov/public/api/awards`
   returns `403 ForbiddenException` (AWS API Gateway, via CloudFront) on every
   documented example, including `?firm=luna` and `?agency=DOE&year=2010`. The
   `/awards` page links a **bulk CSV** instead, which is a better fit anyway.
3. **The merge-queue ticket is not a blocker.** Normalizing every Form C and
   SBIR name exactly as `normalizeName` does and diffing against the live DB:

   | new source | name collisions | domain collisions |
   |---|---|---|
   | Form C (9,048 issuers) | 62 | 9 |
   | SBIR (34,285 firms) | 153 | 12 |

   ~0.5% overlap. These are disjoint populations (Reg CF micro-issuers and
   deep-tech grantees vs. Form D filers and notable Wikidata companies). The
   merge queue remains worth building; it is not load-bearing for this work.

## Desired End State

```bash
make ingest SOURCE=SEC_FORM_C LIMIT=1000000 DAYS=1
make ingest SOURCE=SBIR       LIMIT=1000000 DAYS=1
make ingest SOURCE=SEC_S1     LIMIT=1000000 DAYS=1
make backfill-citations
```

produces, on top of the existing corpus:

- **~9,000 Reg CF issuers** with website, HQ, founding year, headcount and
  signing officers, and **~4,900 crowdfunding rounds** carrying an amount that
  was actually raised;
- **~15,700 SBIR firms** and **~134,000 grant rounds** totalling ~$62bn, all
  `kind: 'Grant'`, excluded from `Company.totalRaisedUsd` and from the market
  tape's deal count, and rendered on the Funding Ladder with a mono `GRANT` tag;
- **investor→company edges** on existing investor profiles, extracted from S-1
  principal-stockholder tables, only where the holder resolves to a firm already
  in the 7,474-row investor universe;
- a `Source`/`Citation` for every new row, with URLs constructed from stored
  identifiers and no network access.

Verified by: `yarn workspace jobs test`, `yarn lint`, `yarn build`, plus the
manual checks in each phase.

### Key discoveries

**Form C — the cleanest of the three.**

- 41 quarterly archives, `https://www.sec.gov/files/dera/data/crowdfunding-offerings-data-sets/{YYYY}q{N}_cf.zip`,
  2016Q2 → 2026Q2, 13 MB total. Unlike ADV, the filenames **are** pattern-stable,
  but the index page is still scraped (same reason: a missing quarter must be a
  no-op, not a 404 storm).
- Parsed all 41: **35,919 filings, 9,048 issuers, 10,945 offerings.**
- **`FILE_NUMBER` is the offering key.** Present on 100% of rows, groups
  `C`/`C-A`/`C-U`/`C-AR`/`C-TR` of one offering, and spans more than one CIK in
  only 6 of 10,945 cases.
- Field coverage on the latest offering doc per file number: name, `ISSUERWEBSITE`,
  city, state, `DATEINCORPORATION` (ISO, 100%), `LEGALSTATUSFORM`, target amount,
  deadline all ≈100%; `MAXIMUMOFFERINGAMOUNT` 98%; `CURRENTEMPLOYEES` 89%.
- **The TSVs need no quoting-aware parser.** Across all 123 `.tsv` members
  checked, *every* data line has exactly the header's tab count — no embedded
  newlines or tabs. `"` is a literal character. A line-split + tab-split reader is
  correct (and simpler than `adv.parser.ts`'s RFC 4180 reader, which the ADV files
  genuinely require).
- `FORM_C_SIGNATURE.tsv` gives 71,580 signer rows: name + title. Names carry a
  `/s/ ` prefix on ~6% of rows.
- 4,841 offerings have a `C-U`; **589 have more than one** (up to 13). So the round
  keys on `FILE_NUMBER` and takes the *latest* progress update — keying on the
  C-U accession would split one offering into up to 13 rounds.
- `primaryDocUrl(cik, accession)` from `sources/sec-edgar/edgar.urls.ts:9`
  resolves for Form C filings unchanged (verified 200).

**Form C progress-update extraction (measured, not estimated).** Prototyped over
all 5,532 `C-U` rows: **4,914 yield an amount, ~$1.8bn across ~3,600 issuers.**
The failures are honest ones — *"Offering closed unsuccessfully"*, *"End of
offering"* — which correctly produce no round. Naive max-of-all-dollar-amounts is
wrong on real rows (*"raised $5455.00, which fell below its minimum goal of
$25,000.00"*), which is what the keyword-anchoring and the max-offering cap are for.

**SBIR — bulk CSV, not the API.**

- `https://data.www.sbir.gov/mod_awarddatapublic_no_abstract/award_data_no_abstract.csv`,
  91 MB, 41 columns, `Last-Modified: 2026-08-01` (monthly), served from S3.
- **219,503 awards, 34,285 firms, $82bn, 1983–2026.** 56% carry a website,
  70% a UEI.
- **UEI is a clean identity key**: 17,161 distinct UEIs, **zero** spanning more
  than one normalized firm name; only 52 names map to more than one UEI. DUNS is
  nearly as clean (8 of 21,598 span >1 name).
- Firm-level slices:

  | slice | firms | awards | $ | website |
  |---|---|---|---|---|
  | all | 34,285 | 219,503 | 82.2bn | 36% |
  | **any award since 2015** | **15,701** | **134,101** | **62.0bn** | **67%** |
  | Phase II + since 2015 | 9,209 | 125,132 | 60.0bn | 73% |

  In the chosen slice, 14,601/15,701 (93%) have a UEI and 15,637 (99.6%) have a
  UEI or DUNS.
- **The CSV needs a streaming, quoting-aware parser.** 55 records span more than
  one physical line, so a line-split is wrong; and `JOBS_MEM_LIMIT` defaults to
  `1536m` (`infra/docker-compose.app.yml:73`), so buffering 91 MB plus 219k row
  objects is not an option.
- `Contact Name` + `Contact Title` are both present on 12,512 post-2015 awards
  (real corporate titles). `PI Name` is present on ~100% but names research
  staff, not company leadership.

**S-1 — feasible, and the largest piece.**

- `efts.sec.gov/LATEST/search-index?q=…&forms=S-1&startdt=&enddt=` works, covers
  2001+, and returns `_id` as `accession:filename` — the document address
  directly, skipping the folder-index round trip.
- Volume: 231 `S-1` + 385 `S-1/A` in 2025 QTR1, 266 + 431 in QTR2 → ~1,000
  original S-1s a year.
- I downloaded 44 real 2025 S-1s and wrote a section-anchored table extractor:
  **31/44 (70%)** produced a usable principal-stockholders table on the first
  pass, with clean rows —
  `Entities affiliated with New Enterprise Associates`,
  `Investment funds affiliated with The Carlyle Group`, `Affiliate of Bain Capital`,
  `Entities affiliated with OrbiMed Advisors LLC`, `FMR LLC`, `Armistice Capital, LLC`.
- Two traps the ticket does not mention:
  1. **Anchoring on any table with a `%` column finds the table of contents** —
     page numbers look like percentages. The parser must locate the *section*
     heading past the TOC, then take the first table under it whose header row
     names a beneficial owner.
  2. **The tables mix firms with individual directors and officers**, and carry
     `All executive officers and directors as a group (8 persons)` summary rows.
- Holder names carry prefixes (`Entities affiliated with X`, `Investment funds
  affiliated with X`, `Affiliate of X`) that must be stripped before matching
  against the investor universe.
- Most S-1 filers are already-public microcaps and SPACs doing resale
  registrations, not IPOs. That is fine — an edge to a now-public company is
  still an edge — but it caps the yield per filing.

**Constraints from the codebase.**

- `NormalizedRecord.round` is **singular** (`sources/ingestion-source.ts:74`).
  Both new sources are many-rounds-per-company (Form C: 1,251 CIKs have >1
  offering; SBIR: 8.5 awards per firm in the chosen slice). Emitting one record
  per round would re-run `upsertCompany` per round and let the last one clobber
  `totalRaisedUsd`. The field becomes plural.
- `Company.totalRaisedUsd` is **never derived from rounds** — it is a stored
  column written only by the source (`ingest.service.ts:450,480`). So excluding
  grants from money aggregates is just "the SBIR source writes 0".
- `MarketService` sums `Company.totalRaisedUsd` and counts every approved
  `FundingRound` (`apps/api/src/market/market.service.ts:62-77,95-108`).
- `SOURCE_LABELS` in `apps/web/components/Citation.tsx:6` is a
  `Record<SourceType, string>`, so adding a `SourceType` is type-enforced across
  the web app.
- `IngestService.enrich` never touches `totalRaisedUsd`, by design
  (`ingest.service.ts:497`).

## What We're NOT Doing

- **No merge queue, no `EntityIdentifier` table, no admin merge UI.** That is
  `thoughts/shared/tickets/2026-08-16-identifier-crosswalk-and-merge.md`, and the
  measured 0.5% collision rate says it does not gate this.
- **No `Company.cikNumber`/`ueiNumber` columns.** Cross-source identity belongs
  to the crosswalk ticket. Form C stores its CIK unpadded so that join is trivial
  later.
- **No new contribution surface for `kind`.** The column is ingest-only and
  defaults to `Equity`; the round DTO and the contribute forms are untouched.
- **No Form C financial statements.** `FORM_C_DISCLOSURE` carries revenue,
  assets, debt and net income for two fiscal years. `Company` has matching
  columns, but these are unaudited issuer-reported figures for micro-issuers;
  publishing them is a separate editorial decision.
- **No SBIR abstracts.** The `no_abstract` CSV variant is used deliberately — the
  full file adds an `Abstract` column and a lot of weight for no schema slot.
- **No `PI Name` people rows** from SBIR. A principal investigator is a role on a
  grant, not a role at the company.
- **No pre-2001 S-1s.** EDGAR full-text search starts at 2001, and the walk is
  bounded further by `S1_START_DATE` (default `2015-01-01`).
- **No S-1 selling-stockholder tables**, only the principal-stockholders /
  beneficial-ownership section.
- **No sector for Form C issuers.** Form C has no industry field; those rows land
  with `industry: []` and `primarySector: null`, and are honestly unclassified.

## Implementation Approach

Five phases, each independently shippable and verifiable.

Phase 1 is the only one that touches the schema and the web app; it lands first
so the two data phases have somewhere honest to put their money. Phases 2 and 3
are self-contained sources. Phase 4 makes everything from 2 and 3 citable. Phase
5 is the S-1 parser, which is the only phase with a real research risk and is
therefore last.

---

## Phase 1: Round kind, plural rounds, source vocabulary

### Overview

Make the domain able to say "this is a grant, not a raise", and let a source emit
more than one round per company.

### Changes Required

#### 1. Schema

**File**: `packages/db/prisma/schema.prisma`

```prisma
model FundingRound {
  …
  amountUsd    BigInt
  postMoneyUsd BigInt?
  lead         String?
  /// Capital type: 'Equity' | 'Debt' | 'Grant' (ROUND_KINDS). Grants — SBIR/STTR
  /// awards — are real capital events but not raised capital, so they are
  /// excluded from Company.totalRaisedUsd and from the market tape's deal count
  /// while still rendering on the funding ladder.
  kind         String   @default("Equity")
  …
}
```

Migration: `yarn workspace @repo/db migrate --name add_funding_round_kind`.
Additive with a default, so `migrate deploy` on prod is a no-op backfill —
every existing row is `Equity`, which is what they are.

#### 2. Shared vocabulary

**File**: `packages/api/src/domain/company.ts`

```ts
/** Capital type of a funding round. Grants are non-dilutive government awards
 *  (SBIR/STTR); they are capital events, not raises, so money aggregates skip
 *  them. Debt covers Reg CF debt offerings. */
export type RoundKind = 'Equity' | 'Debt' | 'Grant';

export const ROUND_KINDS: readonly RoundKind[] = ['Equity', 'Debt', 'Grant'];
```

and on `FundingRound`:

```ts
export interface FundingRound {
  id: string;
  name: string;
  date: string;
  amountUsd: number;
  /** Equity unless the source says otherwise. */
  kind: RoundKind;
  postMoneyUsd: number | null;
  …
}
```

**File**: `packages/api/src/domain/provenance.ts`

```ts
export type SourceType =
  | 'SEC filing'
  | 'Wikidata'
  | 'Government dataset'   // SBIR.gov award data, and future federal bulk files
  | 'Company website'
  | 'Press'
  | 'Other';

export const SOURCE_TYPES: readonly SourceType[] = [
  'SEC filing',
  'Wikidata',
  'Government dataset',
  'Company website',
  'Press',
  'Other',
];
```

#### 3. API

**File**: `apps/api/src/companies/company.mapper.ts` — map `kind: row.kind as RoundKind`
in the round mapper (around line 54).

**File**: `apps/api/src/market/market.service.ts` — both round-scoped queries add
a grant filter, with the reason inline:

```sql
FROM "FundingRound" r
JOIN "Company" c ON c.id = r."companyId"
WHERE r."moderationStatus" = 'APPROVED'
  AND c."moderationStatus" = 'APPROVED'
  -- Non-dilutive government awards are capital events, not deals.
  AND r."kind" <> 'Grant'
```

`getTotals`' `totalRaisedUsd` needs no change: it sums `Company.totalRaisedUsd`,
and the SBIR source writes 0 there.

#### 4. Web

**File**: `apps/web/components/FundingLadder.tsx` — next to `{round.name}`, a
mono meta badge for anything that is not equity:

```tsx
{round.kind !== 'Equity' && (
  <Badge variant="box" mono>
    {round.kind === 'Grant' ? 'Grant' : 'Debt'}
  </Badge>
)}
```

**File**: `apps/web/components/Citation.tsx` — `SOURCE_LABELS` gains
`'Government dataset': 'GOV'`. (`Record<SourceType, …>` makes this a compile
error until it is added.)

#### 5. Ingestion contract

**File**: `apps/jobs/src/sources/ingestion-source.ts`

```ts
/** One capital event contributed by a source. */
export interface NormalizedRound {
  /** Stable id of this round within the source (Form D accession, Reg CF file
   *  number, SBIR contract number). */
  externalId: string;
  name: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  amountUsd: number;
  /** Defaults to 'Equity'. */
  kind?: RoundKind;
}
```

and on `NormalizedRecord`, `round?: {…}` becomes:

```ts
  /** Every round this record contributes. Plural because a Reg CF issuer runs
   *  several offerings and an SBIR grantee wins many awards — one record per
   *  round would re-run the company upsert per round and let the last one
   *  overwrite totalRaisedUsd. */
  rounds?: NormalizedRound[];
```

**File**: `apps/jobs/src/ingest/ingest.service.ts` — `upsert` loops:

```ts
for (const round of r.rounds ?? []) {
  await this.prisma.fundingRound.upsert({
    where: {
      externalSource_externalId: { externalSource: r.source, externalId: round.externalId },
    },
    create: {
      companyId,
      name: round.name,
      date: new Date(round.date),
      amountUsd: BigInt(Math.round(round.amountUsd)),
      kind: round.kind ?? 'Equity',
      externalSource: r.source,
      externalId: round.externalId,
      moderationStatus: 'APPROVED',
    },
    update: {
      amountUsd: BigInt(Math.round(round.amountUsd)),
      date: new Date(round.date),
      kind: round.kind ?? 'Equity',
    },
  });
}
```

**File**: `apps/jobs/src/sources/sec-edgar/sec-edgar.source.ts` — `toRecord`
returns `rounds: [{ externalId: roundExternalId, name: 'Private placement (Form D)', date, amountUsd: parsed.amountSoldUsd }]`.

#### 6. Shared helper move

**File**: `apps/jobs/src/util/text.ts` (new) — move `titleCaseFirm` out of
`sources/sec-adv/adv.parser.ts` (Form C needs it for `MAIN OFFICE CITY`-style
all-caps values). `adv.parser.ts` re-imports it; its spec is updated to import
from the new home.

### Success Criteria

#### Automated Verification:
- [x] Migration applies cleanly: `make db-up`
- [x] Prisma client regenerates: `yarn workspace @repo/db generate`
- [x] Everything builds: `yarn build`
- [x] Jobs tests pass, including the updated `round`→`rounds` cases in
      `apps/jobs/src/ingest/ingest.service.spec.ts:199,205`: `yarn workspace jobs test`
- [x] API tests pass: `yarn workspace api test`
- [x] Lint is clean at `--max-warnings 0`: `yarn lint`
- [x] Every existing round is Equity:
      `docker exec capbase-postgres psql -U capbase -d capbase -c 'select kind, count(*) from "FundingRound" group by 1;'`

#### Manual Verification:
- [ ] A company profile's Funding Ladder is visually unchanged (no badge, since
      everything is `Equity`)
- [ ] The landing market tape shows the same figures as before the migration

**Implementation Note**: pause here for confirmation that the tape is unchanged
before adding data that depends on the filter.

---

## Phase 2: SEC Form C (Reg CF)

### Overview

~9,000 crowdfunded issuers with near-complete metadata, and ~4,900 rounds whose
amount is the money that actually arrived.

### Changes Required

#### 1. Client

**File**: `apps/jobs/src/sources/sec-form-c/form-c.client.ts` (new)

Modelled on `AdvClient` (`sources/sec-adv/adv.client.ts`) — same 160ms start
throttle, same 120s timeout for multi-MB archives, same "scrape the index, never
construct a URL" rule.

```ts
export const FORM_C_INDEX_URL =
  'https://www.sec.gov/data-research/sec-markets-data/crowdfunding-offerings-data-sets';

export interface FormCQuarter {
  /** `2026q2` — the quarter token shared by the archive and its folder. */
  label: string;
  url: string;
}

/** Quarterly archives linked from the index page, newest first.
 *  Unlike the ADV filenames these ARE pattern-stable (`{YYYY}q{N}_cf.zip`), but
 *  the page is still scraped: a quarter the SEC has not published must be
 *  absent, not a 404. */
export function parseFormCQuarters(html: string): FormCQuarter[];

@Injectable()
export class FormCClient {
  /** Every `.tsv` member of one quarterly ZIP, keyed by bare filename
   *  (`FORM_C_SUBMISSION.tsv`). UTF-8 — unlike the latin-1 ADV files. */
  async fetchQuarter(url: string): Promise<Record<string, string> | null>;
  async listQuarters(): Promise<FormCQuarter[]>;
}
```

`FORM_C_MIN_QUARTER` (default `2016q2`, i.e. everything) bounds the walk.
Note `FORM_C_COISSUER_INFORMATION.tsv` is present in only 22 of the 41 archives —
a missing member is normal and must not throw.

#### 2. Parser

**File**: `apps/jobs/src/sources/sec-form-c/form-c.parser.ts` (new)

```ts
export const SEC_FORM_C = 'SEC_FORM_C';

/**
 * Tab-separated reader for the DERA Form C tables.
 *
 * Deliberately NOT the RFC 4180 reader `adv.parser.ts` needs: verified across
 * all 41 quarterly archives (123 .tsv members) that every data line carries
 * exactly the header's tab count — no embedded newlines, no embedded tabs, and
 * `"` is a literal character rather than a delimiter. A line split is correct
 * here, and a quote-aware parser would corrupt names containing a quote.
 */
export function parseTsv(text: string): Row[];
```

Then the join. Every table keys on `ACCESSION_NUMBER`; offerings group by
`FILE_NUMBER` from `FORM_C_SUBMISSION.tsv`:

```ts
export interface FormCOffering {
  fileNumber: string;      // '020-22903' — the offering identity
  cik: string;             // stored UNPADDED, matching SEC_EDGAR's CIKs
  /** Latest C / C-A filing for this offering. */
  offering: { accession: string; filedAt: string; info: Row; disclosure: Row };
  /** Latest C-U, when the offering has one. 589 offerings have several. */
  progress?: { accession: string; filedAt: string; info: Row; disclosure: Row };
  signers: { name: string; title: string }[];
}

export function groupOfferings(tables: Record<string, Row[]>): FormCOffering[];
```

#### 3. Progress-update amount extraction

**File**: `apps/jobs/src/sources/sec-form-c/progress-update.ts` (new)

```ts
/**
 * The amount actually raised, from a C-U progress update's free text.
 *
 * Form C's data set publishes the TARGET and MAXIMUM offering amounts as
 * columns, never the proceeds — those exist only as prose:
 *   "Vigilante Gaming Bar, LLC has raised a total of $119,700."
 *   "The Offering ended early on June 9, 2026 having raised a total of $10,522.32."
 * Measured over all 5,532 C-U filings in the 2016Q2–2026Q2 archives: 4,914
 * yield an amount. The rest are honest misses — "Offering closed
 * unsuccessfully", "End of offering" — and correctly produce no round.
 *
 * Taking the largest dollar figure is wrong on real filings:
 *   "The issuer raised $5455.00, which fell below its minimum goal of $25,000.00."
 * so candidates are scored by the nearest preceding keyword and capped by the
 * maximum the offering registered.
 */
export function parseRaisedUsd(text: string, maxOfferingUsd: number | null): number | null;
```

Rules, in order:

1. Candidates are every `/\$\s?[\d,]+(?:\.\d{1,2})?/` match.
2. Drop a candidate immediately followed by `per share|per unit|each` — that is a
   unit price (*"549.5 future equity units sold at $100 each"*).
3. Drop a candidate above `maxOfferingUsd × 1.05` when a maximum is known: a
   Reg CF raise cannot exceed the maximum it registered. When no maximum is
   filed, fall back to the statutory ceiling for the filing year
   (`$1,070,000` before 2021-03-15, `$5,000,000` after).
4. Score by the **last** keyword in the 45 characters before the match:
   `raised|raising|proceeds|total|totaling|sold|received|closed|settled|invested|investments?`
   scores 2; `target|minimum|goal|maximum|fee|commission|net` scores 0.
5. Highest score wins; ties break to the larger amount. No survivor → `null`.

Spec fixtures are the real strings above plus
`"Offering on Democracy VC MicroVentures platform completed and terminated. Amount raised: $184,363; Commissions to Democracy VC: $12,905.41; …"`
(must pick 184,363, not the commission and not the net).

#### 4. Source

**File**: `apps/jobs/src/sources/sec-form-c/sec-form-c.source.ts` (new)

```ts
@Injectable()
export class SecFormCSource implements IngestionSource {
  readonly name = SEC_FORM_C;
  /** `days` is ignored — the crowdfunding data sets are quarterly snapshots. */
  async fetch(opts: FetchOptions): Promise<NormalizedRecord[]>;
}
```

Walks every quarter (newest first), groups offerings by `FILE_NUMBER`, then
groups those by CIK into one record per issuer.

Mapping, field by field:

| target | from | note |
|---|---|---|
| `companyExternalId` | `CIK`, leading zeros stripped | matches `SEC_EDGAR`'s CIK form so a later crosswalk is a plain join |
| `company.name` | `NAMEOFISSUER` of the newest offering | |
| `company.hq` | `titleCase(CITY)`, `STATEORCOUNTRY` | 100% present |
| `company.foundedYear` | `Number(DATEINCORPORATION.slice(0, 4))` | ISO on 10,944/10,945 |
| `company.domain` | `identifyingDomain(ISSUERWEBSITE)` | `util/domain.ts` — nulls out platform hosts |
| `company.websiteUrl` | normalized `ISSUERWEBSITE` | |
| `company.headcount` | `CURRENTEMPLOYEES` | 89% |
| `company.stage` | `'Seed'` | structural, not guessed: Reg CF is retail seed capital, statutorily capped at $5M |
| `company.status` | `'Private'` | |
| `company.industry` / `primarySector` | `[]` / `null` | Form C has no industry field |
| `company.oneLiner` | `` `Raised capital from retail investors through a Regulation Crowdfunding offering on ${portal}.` `` | `COMPANYNAME` is the intermediary, 100% present |
| `company.totalRaisedUsd` | sum of the issuer's parsed raises | 0 when none parsed |
| `rounds[]` | one per `FILE_NUMBER` **with** a parsed amount | see below |
| `people[]` | `FORM_C_SIGNATURE` | see below |

Rounds:

```ts
{
  externalId: offering.fileNumber,              // '020-22903'
  name: 'Crowdfunding raise (Reg CF)',
  date: offering.progress!.filedAt,             // the C-U that reported the close
  amountUsd: raised,
  kind: disclosure.SECURITYOFFEREDTYPE === 'Debt' ? 'Debt' : 'Equity',
}
```

An offering with no parseable raise contributes **no round** — the company still
lands with its metadata and officers. This is the deliberate choice not to print
a target as though it were proceeds.

People: `PERSONSIGNATURE` with a leading `/s/ ` stripped, dropped when the name
matches the entity heuristic already used by the Form D parser
(`form-d.parser.ts:76`), `role` = `PERSONTITLE`, `since` = filing year,
`externalId` = `` `${cik}:person:${kebab(name)}` `` — the same keying as Form D,
so re-filings update in place.

#### 5. Wiring

**File**: `apps/jobs/src/ingest/ingest.module.ts` — register `FormCClient` +
`SecFormCSource` and add to the `INGESTION_SOURCES` factory.

**File**: `Makefile` — `SOURCE=` help text gains `SEC_FORM_C`; `ingest-all` gains
`node dist/backfill.js 1 1000000 SEC_FORM_C` after the Wikidata step.

**File**: `apps/jobs/.env.example` — document `FORM_C_MIN_QUARTER`.

### Success Criteria

#### Automated Verification:
- [x] Unit tests pass, including `progress-update.spec.ts` and
      `form-c.parser.spec.ts`: `yarn workspace jobs test`
- [x] Lint clean: `yarn lint`
- [x] Build clean: `yarn build`
- [x] A bounded run completes: `make ingest SOURCE=SEC_FORM_C DAYS=1 LIMIT=200`
- [x] Full run lands roughly the measured volumes:
      `select count(*) from "Company" where "externalSource"='SEC_FORM_C';` → ~9,000
      and `select count(*) from "FundingRound" where "externalSource"='SEC_FORM_C';` → ~4,900
- [x] No round exceeds the Reg CF ceiling by more than the oversubscription
      tolerance: `select count(*) from "FundingRound" where "externalSource"='SEC_FORM_C' and "amountUsd" > 5250000;` → 0
- [x] Re-running is idempotent: row counts identical after a second
      `make ingest SOURCE=SEC_FORM_C`

#### Manual Verification:
- [ ] A Form C company profile reads sensibly: real name, website link, HQ,
      founding year, officers, one crowdfunding round on the ladder
- [ ] Spot-check three rounds against the filing on EDGAR — the published amount
      matches the C-U's stated proceeds
- [ ] The directory's sector facets are unaffected (Form C rows are unclassified,
      so they should not appear under any sector)

**Implementation Note**: pause for the spot-check before moving on — the amount
parser is the one piece of this phase that cannot be fully proven by tests.

---

## Phase 3: SBIR / STTR awards

### Overview

~15,700 deep-tech companies and ~134,000 grant rounds, none of which appear in
any other source, and none of which touch the money aggregates.

### Changes Required

#### 1. Streaming CSV utility

**File**: `apps/jobs/src/util/csv.ts` (new)

Move `parseCsv` out of `sources/sec-adv/adv.parser.ts` (unchanged behaviour;
`adv.parser.ts` re-imports it, its spec follows) and add an incremental variant:

```ts
/** Feed-and-emit RFC 4180 parser for files too large to hold as a string.
 *  `write` may be called with arbitrary chunk boundaries, including mid-field
 *  and mid-quote; `end` flushes the final record. */
export function createCsvParser(onRow: (row: Record<string, string>) => void): {
  write(chunk: string): void;
  end(): void;
};
```

#### 2. Client

**File**: `apps/jobs/src/sources/sbir/sbir.client.ts` (new)

```ts
/** SBIR.gov's bulk award file. The documented JSON API
 *  (api.www.sbir.gov/public/api/awards) returns 403 ForbiddenException from its
 *  API gateway on every documented example, and a snapshot suits us better:
 *  this is one request instead of ~2,200 paged ones. */
export const SBIR_AWARDS_CSV =
  'https://data.www.sbir.gov/mod_awarddatapublic_no_abstract/award_data_no_abstract.csv';

@Injectable()
export class SbirClient {
  /** Stream the award file, invoking `onRow` per record.
   *  Never buffered: the file is ~91 MB, 55 records span more than one physical
   *  line (so a line split is wrong), and JOBS_MEM_LIMIT defaults to 1536m. */
  async streamAwards(onRow: (row: SbirRow) => void): Promise<SbirSnapshot | null>;
}

export interface SbirSnapshot {
  /** The file's Last-Modified, e.g. '2026-08-01' — logged so a run is auditable. */
  label: string;
  url: string;
}
```

Same User-Agent/timeout discipline as the other clients; no throttle needed for a
single request.

#### 3. Parser

**File**: `apps/jobs/src/sources/sbir/sbir.parser.ts` (new)

```ts
export const SBIR = 'SBIR';

/** Firm identity, best available first.
 *  Measured over the whole file: 17,161 distinct UEIs, ZERO of which span more
 *  than one normalized firm name; 8 of 21,598 DUNS do. In the ingested slice
 *  (any award since 2015) 93% have a UEI and 99.6% have a UEI or DUNS. */
export function firmKey(row: SbirRow): string;   // `uei:…` | `duns:…` | `name:…`
```

`mapSbirAwards(rows, minYear)` aggregates per firm:

- keep a firm when **any** of its awards is from `minYear` or later
  (`SBIR_MIN_YEAR`, default `2015`), then ingest all of its awards so the history
  is complete;
- `company.name` — the firm name from its most recent award;
- `hq` = `` `${City}, ${State}` ``, `headcount` = `Number Employees`,
  `domain` = `identifyingDomain(Company Website)`, `websiteUrl` = the normalized URL;
- `industry` = `[Agency, Branch]` filtered;
- `primarySector` = `sectorFor(award titles joined)` from
  `sources/wikidata/wikidata.mapper.ts:48`, falling back to `agencySector(Agency)`;
- `foundedYear` = 0 (not disclosed), `stage` = `'Seed'`, `status` = `'Private'`;
- **`totalRaisedUsd` = 0** — grant money is not raised capital, and this column
  is what the market tape sums;
- `people`: `Contact Name` + `Contact Title` when both are non-blank (12,512
  post-2015 awards), role = the title, keyed
  `` `${firmKey}:person:${kebab(name)}` ``. `PI Name` is skipped.

Rounds, one per award:

```ts
{
  externalId: `${firmKey}:${contract || trackingNumber}`,
  name: `${program} ${phase} award (${agencyShort})`,   // 'SBIR Phase II award (NASA)'
  date: proposalAwardDate || `${awardYear}-01-01`,
  amountUsd: awardAmount,
  kind: 'Grant',
}
```

**File**: `apps/jobs/src/sources/sbir/agency-sector.ts` (new) — a deterministic
map from the awarding agency, `null` where the agency funds everything:

```ts
export const AGENCY_SECTOR_MAP: Readonly<Record<string, Sector | null>> = {
  'Department of Health and Human Services': 'Healthcare',
  'Department of Energy': 'Energy',
  'Department of Agriculture': 'Industrials',
  'Department of Transportation': 'Transport',
  'Environmental Protection Agency': 'Climate',
  'Department of Education': 'Education',
  'National Aeronautics and Space Administration': 'Industrials',
  'Department of Commerce': null,
  'Department of Defense': null,   // funds every sector; let the keywords decide
  'National Science Foundation': null,
};
```

#### 4. Source + wiring

**File**: `apps/jobs/src/sources/sbir/sbir.source.ts` (new) — `fetch()` streams,
aggregates, slices to `opts.limit`, logs the snapshot label. `days` ignored and
documented.

**File**: `apps/jobs/src/ingest/ingest.module.ts` — register and add to the
factory.

**File**: `Makefile` — `SOURCE=` help gains `SBIR`; `ingest-all` gains
`node dist/backfill.js 1 1000000 SBIR`.

**File**: `apps/jobs/.env.example` — document `SBIR_MIN_YEAR` (default `2015`,
"set to 1983 for the full history: 34,285 firms and 219,503 awards").

### Success Criteria

#### Automated Verification:
- [x] `yarn workspace jobs test` — includes a `createCsvParser` case that splits
      a quoted, newline-containing field across two `write` chunks, and the
      unchanged ADV parser suite against its new import path
- [x] `yarn lint`, `yarn build`
- [x] Bounded run: `make ingest SOURCE=SBIR DAYS=1 LIMIT=200`
- [x] Full run lands near the measured slice:
      `select count(*) from "Company" where "externalSource"='SBIR';` → ~15,700
      and `select count(*) from "FundingRound" where "externalSource"='SBIR';` → ~134,000
- [x] **Grants never enter the money columns**:
      `select count(*) from "FundingRound" where "externalSource"='SBIR' and kind <> 'Grant';` → 0
      and `select coalesce(sum("totalRaisedUsd"),0) from "Company" where "externalSource"='SBIR';` → 0
- [x] The full run survives a heap smaller than the file, proving nothing is
      buffered: `cd apps/jobs && node --max-old-space-size=512 dist/backfill.js 1 1000000 SBIR`
      completes without OOM
- [x] Idempotent on a second run

#### Manual Verification:
- [ ] `/` market tape totals and deal count are unchanged from before the SBIR run
- [ ] An SBIR company profile shows its awards on the ladder, each tagged `Grant`
- [ ] Spot-check two awards against sbir.gov — company, amount and year match

**Implementation Note**: the tape check is the important one. Pause here.

---

## Phase 4: Citations and documentation for the new sources

### Overview

Every new row gets a source link, built from identifiers already on the row and
with no network access — the standing rule from `backfill-citations.ts`.

### Changes Required

#### 1. URL builders

**File**: `apps/jobs/src/sources/sec-edgar/edgar.urls.ts`

```ts
/** The filer's Form C filing history on EDGAR. */
export function filerFormCUrl(cik: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=C`;
}

/** One Reg CF offering, addressed by its EDGAR file number (020-XXXXX) — the
 *  identity a Form C round is keyed on. An offering can have several C-U
 *  progress updates, so the file number, not any one accession, is the offering. */
export function formCOfferingUrl(fileNumber: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=${fileNumber}&type=C`;
}
```

Both verified to return 200.

**File**: `apps/jobs/src/sources/sbir/sbir.urls.ts` (new)

```ts
/** SBIR awards have no per-award public page derivable from the bulk file, so a
 *  citation points at the dataset actually read, with the award's contract
 *  number as the reference. Honest: that file IS the document the fact came
 *  from. A guessed award URL would be worse than none — see DATA_REBUILD.md. */
export const SBIR_AWARD_DATA_URL = SBIR_AWARDS_CSV;
```

#### 2. Backfill

**File**: `apps/jobs/src/backfill-citations.ts`

- `walkCompanies` widens to `in: [SEC_EDGAR, WIKIDATA, SEC_FORM_C, SBIR]`;
  Form C companies cite `filerFormCUrl(cik)`, SBIR companies cite
  `SBIR_AWARD_DATA_URL` with `sourceType: 'Government dataset'`,
  `publisher: 'SBIR.gov'`, `reference: null`.
- `walkRounds` stops being SEC_EDGAR-only and switches on `externalSource`:
  Form D → `primaryDocUrl(cik, accession)` (unchanged), Form C →
  `formCOfferingUrl(fileNumber)`, SBIR → the dataset URL with
  `reference` = the contract number carried in the round's `externalId` suffix.
- `walkPeople` adds Form C (→ `filerFormCUrl`) and SBIR (→ dataset URL).

Everything stays idempotent: `Source` upserts by `url`, `Citation` by its
four-column key.

#### 3. Documentation

**File**: `docs/DATA_REBUILD.md`

- the "what comes from where" table gains three rows with the measured volumes;
- a note that Form C proceeds are text-extracted from C-U filings and that an
  offering without a parseable amount deliberately gets no round;
- a note that SBIR grants are `kind: 'Grant'` and are excluded from money
  aggregates;
- the full-rebuild command lists gain the new `SOURCE=` invocations;
- a new **"Adding a source to an existing dataset"** section: run the source
  locally against the corpus you already have, then `make db-dump` +
  `make deploy-restore` — rather than paying for a 91 MB download and 134,000
  upserts twice. It names the caveat that `deploy-restore` replaces the `User`
  table, so a prod backup comes first.

**File**: `CLAUDE.md` — the Jobs section gains the three sources; **the standing
claim that "no free source discloses investor→company edges" is narrowed** to
Form D and Form ADV, with S-1 named as the exception (landing in Phase 5).

### Success Criteria

#### Automated Verification:
- [x] `make backfill-citations` completes and reports a skip count, not errors
- [x] Every new company has a citation:
      `select count(*) from "Company" c where c."externalSource" in ('SEC_FORM_C','SBIR') and not exists (select 1 from "Citation" ct where ct."entityType"='company' and ct."entityId"=c.id);` → 0
- [x] Re-running mints no duplicates (`Source` and `Citation` counts stable)
- [x] `yarn lint`, `yarn build`

#### Manual Verification:
- [ ] A Form C company profile shows `[SEC]` markers that open the right EDGAR page
- [ ] An SBIR company shows `[GOV]` markers
- [ ] No fact on either profile renders a bare em dash where a source exists

---

## Phase 5: S-1 principal stockholders → investor edges

### Overview

The payoff phase: real portfolios on investor profiles that are empty today.
Scoped to edges we can attach with confidence — a holding is created only when
the holder resolves to a firm already in the investor universe.

### Changes Required

#### 1. Holdings that require a known firm

**File**: `apps/jobs/src/sources/ingestion-source.ts` — on `NormalizedInvestor`:

```ts
  /** Drop this holding unless the firm already exists.
   *  S-1 ownership tables name holders with no type signal at all — a row can be
   *  a VC fund, a corporate parent, a family trust or a founder — and
   *  CLAUDE.md's rule is that InvestorType comes from source structure, never
   *  from a firm's name. So these edges attach to firms the ADV/Wikidata sweeps
   *  already typed, and are dropped otherwise. */
  onlyIfKnown?: boolean;
```

**File**: `apps/jobs/src/ingest/ingest.service.ts` — `resolveInvestor` returns
`{ id, type } | null` instead of `string | null`: it returns `null` (rather than
creating a row) when `onlyIfKnown` is set and nothing matches, and the caller
uses the **resolved firm's** type for the holding rather than the source's.

#### 2. Client

**File**: `apps/jobs/src/sources/sec-s1/s1.client.ts` (new)

```ts
/** EDGAR full-text search. Its hit `_id` is `accession:filename`, which
 *  addresses the document directly — no folder-index round trip. Coverage
 *  starts in 2001; S1_START_DATE (default 2015-01-01) bounds it further. */
const EFTS_URL = 'https://efts.sec.gov/LATEST/search-index';

@Injectable()
export class S1Client {
  /** S-1 and S-1/A documents in a date window, walked month by month because a
   *  single query caps at 10,000 hits. */
  async listS1Docs(from: string, to: string): Promise<S1Ref[]>;
  async fetchDocument(ref: S1Ref): Promise<string | null>;
}
```

Same 160ms throttle as `EdgarClient` (the SEC's 10 req/s cap is per-IP across
every sec.gov host). Documents average ~800 KB and reach 7.5 MB, so the fetch
timeout is 120s and only one document is held at a time.

#### 3. Ownership parser

**File**: `apps/jobs/src/sources/sec-s1/ownership.parser.ts` (new)

```ts
export interface OwnershipRow {
  name: string;
  /** Percentage of the class, when the cell parses. */
  percent: number | null;
  shares: number | null;
  /** 0–1 from structural signals only — never from how plausible the name looks. */
  confidence: number;
}

/**
 * The principal-stockholders table from an S-1.
 *
 * Anchoring on "any table containing a % column" finds the TABLE OF CONTENTS:
 * page numbers parse as percentages. So the parser locates the section heading
 * ("Principal stockholders", "Security ownership of certain beneficial
 * owners", …) past the first 15% of the document, then takes the first table
 * under it whose header row names a beneficial owner.
 *
 * Measured on 44 real 2025 S-1s: 31 (70%) yield a table on this path.
 */
export function parseOwnership(html: string): OwnershipRow[];
```

Row handling:

- drop `All (current )?(executive )?(officers|directors) …as a group` summary rows;
- drop group headings ending in `:` (`5% Stockholders:`);
- strip trailing footnote markers — `Baker Hughes Holdings LLC(5)` → `Baker Hughes Holdings LLC`;
- strip the affiliation prefixes seen in the sample: `Entities affiliated with `,
  `Investment funds affiliated with `, `Affiliates? of `;
- `—` is zero, `*` is "less than 1%".

Confidence is structural and additive:

| signal | weight |
|---|---|
| table found under a section heading (not the TOC) | 0.4 |
| header row names a beneficial owner | 0.2 |
| a percentage cell parsed for this row | 0.2 |
| the name carries a legal-entity token (`LLC`, `LP`, `Ltd`, `Fund`, `Partners`, `Capital`, `Ventures`, `Holdings`) | 0.2 |

`S1_MIN_CONFIDENCE` (default `0.6`) gates emission, so an individual director in
the same table — no entity token, and often no percentage — falls below the line
without needing a name-based person/company classifier.

#### 4. Source

**File**: `apps/jobs/src/sources/sec-s1/sec-s1.source.ts` (new)

One record per filer CIK, carrying **no** `rounds` and **no** company money — an
S-1 says who owns the company, not what it raised. It contributes:

- `company`: name and CIK from the filing header, so an unmatched issuer still
  gets a row rather than the edge being dropped;
- `investors[]`: one `NormalizedInvestor` per surviving row, with
  `onlyIfKnown: true`, `externalId` = `` `${cik}:holder:${kebab(name)}` ``,
  `firstRound: 'Undisclosed'`, `rounds: 0`.

`S1_START_DATE` (default `2015-01-01`) bounds the walk; `opts.limit` caps
documents fetched.

#### 5. Wiring

Module registration, `Makefile` `SOURCE=` help gains `SEC_S1` and `ingest-all`
gains its line (no bespoke target — `make ingest SOURCE=SEC_S1` is the way in),
`.env.example` entries for `S1_START_DATE` and `S1_MIN_CONFIDENCE`, and
`backfill-citations.ts` gains investor-holding citations pointing at the S-1
document URL (`sourceType: 'SEC filing'`, `reference` = the accession).

### Success Criteria

#### Automated Verification:
- [x] `ownership.parser.spec.ts` covers, as fixtures cut from real filings: the
      TOC trap, a multi-class-column layout, footnote-marked names, an
      `Entities affiliated with …` prefix, and an
      `All executive officers and directors as a group` row
- [x] `yarn workspace jobs test`, `yarn lint`, `yarn build`
- [x] A bounded run completes: `make ingest SOURCE=SEC_S1 DAYS=1 LIMIT=50`
- [x] Every emitted holding resolved to a real firm:
      `select count(*) from "InvestorHolding" where "externalSource"='SEC_S1' and "investorId" is null;` → 0
- [x] Investor profiles gain portfolios:
      `select count(distinct "investorId") from "InvestorHolding" where "externalSource"='SEC_S1';` → > 0
- [x] Idempotent on a second run

#### Manual Verification:
- [ ] Pick five holdings at random and open the cited S-1 — the firm really is
      named in that filing's ownership table
- [ ] A well-known investor profile (e.g. an ADV-sourced VC) now renders a
      portfolio grid instead of the empty state
- [ ] No individual person appears as an investor firm

---

## Testing Strategy

### Unit tests

Pure parser/mapper specs, matching the existing convention (`@jest/globals`,
fixtures copied from real source data — see `adv.parser.spec.ts:13`):

- `form-c.parser.spec.ts` — TSV reading; grouping by `FILE_NUMBER`; an offering
  with 3 C-U filings collapsing to one round; a missing
  `FORM_C_COISSUER_INFORMATION.tsv` member.
- `progress-update.spec.ts` — the real strings quoted above, plus the
  unsuccessful-close cases that must return `null`, plus the max-offering cap.
- `csv.spec.ts` — `createCsvParser` with chunk boundaries falling mid-field,
  mid-quote and mid-CRLF.
- `sbir.parser.spec.ts` — `firmKey` precedence (UEI → DUNS → name); the
  `SBIR_MIN_YEAR` firm filter keeping a firm's *older* awards; every emitted
  round being `kind: 'Grant'` with `totalRaisedUsd: 0`.
- `agency-sector.spec.ts` — the map, and `null` for DoD/NSF.
- `ownership.parser.spec.ts` — as listed in Phase 5.
- `ingest.service.spec.ts` — extended for plural `rounds`, for `kind`
  round-tripping, and for an `onlyIfKnown` holding being dropped when no firm
  matches.

### Integration

No new harness. Each phase's "bounded run" (`LIMIT=200`) against the local
Postgres is the integration test, followed by the SQL assertions listed per phase.

### Manual testing steps

1. `make db-up && make ingest SOURCE=SEC_FORM_C DAYS=1 LIMIT=200`
2. Open `/companies/<a-form-c-slug>` — metadata, officers, one round with a
   `[SEC]` citation.
3. Note `/`'s tape figures. Run `make ingest SOURCE=SBIR DAYS=1 LIMIT=200`.
   Reload `/` — **the figures must not move.**
4. Open an SBIR company — awards on the ladder, each tagged `Grant`.
5. `make ingest SOURCE=SEC_S1 DAYS=1 LIMIT=50`, then open an investor profile
   that was empty and confirm a real portfolio.
6. Re-run each source and confirm counts are stable.

## Performance Considerations

- **Form C**: 41 requests totalling 13 MB, throttled to ~6/s. A full run is
  dominated by ~36,000 upserts, not by the network.
- **SBIR**: one 91 MB request, streamed. Buffering is not an option —
  `JOBS_MEM_LIMIT` defaults to `1536m` (`infra/docker-compose.app.yml:73`) and
  219,503 row objects would exceed it. Aggregating into ~15,700 firm records as
  rows arrive keeps peak memory in the low hundreds of MB. 134,000 round upserts
  is the long pole; the existing per-1,000 progress log applies.
- **S-1**: ~1,000 documents a year at ~800 KB average, one held at a time. At
  the shared 6 req/s SEC budget, a 2015-onward walk is a few hours — a manual
  backfill, never the cron.
- **`MarketService`**: the added `kind <> 'Grant'` predicate sits on a scan that
  already groups the whole `FundingRound` table. Adding ~134,000 rows roughly
  doubles it, still well inside the web app's 60s ISR window. Revisit only if
  the tape gets slow.
- **Run a rebuild with revisions off.** `INGEST_RECORD_REVISIONS=false` — these
  phases create a corpus rather than change published figures
  (`docs/DATA_REBUILD.md`).

## Migration Notes

- `add_funding_round_kind` is additive with a default, so `prisma migrate deploy`
  on the api container's boot is safe and needs no backfill: every pre-existing
  round is equity, which is what `Equity` means.
- No data is destroyed or rewritten. All three sources are additive and keyed on
  `(externalSource, externalId)`, so every command is re-runnable.
- Rollback: `SEC_FORM_C`, `SBIR` and `SEC_S1` rows are deletable by
  `externalSource` alone, and the `kind` column can be left in place (unused
  columns cost nothing) if a source is backed out.
- **No new `make` targets.** Each source registers a name, so `make ingest
  SOURCE=…` already reaches it, and `ingest-all` gains one line each so the
  from-scratch rebuild stays true to its name:

  ```make
  ingest-all:
  	…
  	cd apps/jobs && node dist/backfill.js 1 1000000 SEC_FORM_C
  	cd apps/jobs && node dist/backfill.js 1 1000000 SBIR
  	cd apps/jobs && node dist/backfill.js 1 1000000 SEC_S1
  	cd apps/jobs && node dist/backfill-sectors.js
  	cd apps/jobs && node dist/backfill-citations.js
  ```

- **This rollout does not run `ingest-all`.** The existing corpus (11,290
  companies from Form D, Wikidata and ADV) is already in the local DB, and
  `ingest-all` would re-walk ten years of Form D daily indexes for hours to
  arrive back where it started. The new sources append to what is there:

  ```bash
  make ingest SOURCE=SEC_FORM_C DAYS=1 LIMIT=1000000
  make ingest SOURCE=SBIR       DAYS=1 LIMIT=1000000
  make ingest SOURCE=SEC_S1     DAYS=1 LIMIT=1000000
  make backfill-sectors
  make backfill-citations
  ```

  `ingest-all` stays correct for a from-scratch rebuild; it is just not the
  command for this change.

- **Production gets a dump, not an ingest.** Everything above runs on the laptop
  against the local Postgres; prod receives the finished database:

  ```bash
  make db-dump                                    # → backups/capbase-<stamp>.dump
  make deploy-restore FILE=backups/capbase-<stamp>.dump VPS=user@host CONFIRM=yes
  ```

  This is the right call for these sources — SBIR alone is a 91 MB download and
  134,000 upserts, and doing it twice buys nothing. The dump carries
  `_prisma_migrations`, so `add_funding_round_kind` arrives with the data and the
  api container's `prisma migrate deploy` is a no-op on next boot.

  **Two things to know before running it.** `deploy-restore` replaces *every* row
  in production, including the `User` table and any contribution or moderation
  made on prod since the last dump — so either accept that, or pull a prod
  backup first (`make deploy-backup`) and reconcile. And the local DB must be on
  the same migration as the deployed code, which it will be if Phase 1 was
  applied locally before the ingest runs.

- The daily cron is untouched: `INGEST_SOURCES` stays `SEC_EDGAR`. All three new
  sources are snapshots and are run by hand, exactly like `SEC_ADV`.
- The `*-prod` ingest targets stay available and untouched, for the case where a
  source needs re-running on the box without a full dump cycle.

## References

- Original ticket: `thoughts/shared/tickets/2026-08-16-form-c-s1-sbir-ingestion.md`
- Related, deliberately not blocking: `thoughts/shared/tickets/2026-08-16-identifier-crosswalk-and-merge.md`
- Prior art for a snapshot source: `apps/jobs/src/sources/sec-adv/sec-adv.source.ts:47`
- Prior art for a bulk-file client: `apps/jobs/src/sources/sec-adv/adv.client.ts:78`
- Match-and-enrich: `apps/jobs/src/ingest/ingest.service.ts:432`
- Citation URL discipline: `apps/jobs/src/backfill-citations.ts:24`, `docs/DATA_REBUILD.md`
- Domain-as-match-key rules: `apps/jobs/src/util/domain.ts:1`
- Form C data sets: https://www.sec.gov/data-research/sec-markets-data/crowdfunding-offerings-data-sets
- SBIR award data: https://www.sbir.gov/awards (bulk CSV, since the JSON API 403s)
