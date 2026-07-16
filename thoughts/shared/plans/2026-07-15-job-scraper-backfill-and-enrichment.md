# Job Scraper: Date-Range Backfill + Entity Enrichment Implementation Plan

## Overview

Make the SEC EDGAR ingestion actually fill the database: backfill **90 days** of Form D
filings (not one day capped at 50), skip pooled-fund/SPV noise, extract **people**
(executives/directors) from the filings we already fetch, and add a second **Wikidata**
ingestion source that supplies the entities Form D can never provide — **investors,
founders/CEOs, acquisitions, and exits** — for ~6.4k notable companies. Everything runs
locally first via `make ingest`.

## Current State Analysis

- `EdgarClient.listRecentFormD` (`apps/jobs/src/sources/sec-edgar/edgar.client.ts:31`)
  reads **one day's** daily index (walks back ≤5 days but stops at the first non-empty
  day). ~230 Form D/A filings exist per business day.
- `INGEST_LIMIT`/backfill arg default to **50** (`apps/jobs/src/backfill.ts:11`,
  `apps/jobs/.env.example`). Net effect: ≤50 filings from a single day. This is the
  "only scraping 50" the ticket describes.
- `IngestService.upsert` (`apps/jobs/src/ingest/ingest.service.ts:51`) writes only
  `Company` + `FundingRound`. Nothing populates `Person`, `InvestorHolding`,
  `AcquisitionDeal`, `ExitEvent` — hence the empty profile sections.
- `NormalizedFiling` (`apps/jobs/src/sources/ingestion-source.ts:8`) has no shape for
  child entities; `IngestionSource.fetchRecent(limit)` has no date-range concept.
- Verified against live SEC data (2026-07-13 index + `primary_doc.xml`):
  - Form D XML includes `relatedPersonsList` (names + `Executive Officer` / `Director` /
    `Promoter` relationships + `relationshipClarification`) — free people data.
  - Form D **never names investors** (only `investors.totalNumberAlreadyInvested`, a
    count). Acquisitions/exits aren't in Form D at all.
  - The **majority of filers are pooled funds/SPVs** (`industryGroupType =
    "Pooled Investment Fund"`), e.g. "AGC Skild I a Series of AGC AI Nexus Fund LLC".
  - Amendments (`D/A`) carry `<isAmendment>true</isAmendment>` +
    `<previousAccessionNumber>` — today each D/A would create a duplicate round because
    `roundExternalId = accession`.
- Verified Wikidata (live SPARQL): **6,434 companies** carry `investor` (P1951)
  statements (7,051 statements), plus founders (P112), CEO (P169), owned-by (P127),
  IPO events (P793=Q184680), website (P856), HQ (P159), employees (P1128).
- Schema gap: `Person`/`InvestorHolding`/`AcquisitionDeal`/`ExitEvent`
  (`packages/db/prisma/schema.prisma:167-245`) lack the `externalSource`/`externalId`
  provenance columns that make `Company`/`FundingRound` upserts idempotent.
- `apps/jobs` has **no jest setup** (no `test` script, no spec files) even though the
  pure functions (`parseFormIndex`, `stageFromAmount`, `safeIsoDate`) are exported for
  testing. `apps/api` has the pattern to mirror (`jest` + `@repo/jest-config`).
- `GET /companies` has **no pagination** (`apps/api/src/companies/companies.service.ts:62`
  `findAllApproved` → `findMany` all rows). Volume knobs (fund filter, day window)
  keep this workable; real pagination is a flagged follow-up, not in this plan.

## Desired End State

- `make ingest` (local) pulls **90 days** of Form D operating-company filings
  (funds skipped), with people rows attached, then runs the Wikidata source to load
  ~6.4k notable companies with investors, people, acquisitions, and exits.
- Re-running any ingest is idempotent (provenance-keyed upserts, amendments update the
  original round in place).
- The daily cron keeps doing a small incremental SEC pass (last 3 days, idempotent).
- Company profiles for notable names (Stripe/OpenAI tier) show investors, people, and
  exits; Form D companies show their executives.

### Key Discoveries:
- One-day index + 50-cap stack: `edgar.client.ts:31-42` + `backfill.ts:11`.
- `relatedPersonsList` in Form D XML → free people data (verified live).
- `industryGroupType === 'Pooled Investment Fund'` cleanly identifies fund/SPV filings.
- D/A amendments include `previousAccessionNumber` → stable round identity.
- Wikidata P1951 coverage: 6,434 companies; P856 websites give us `domain` → Clearbit
  logos light up via `components/CompanyLogo.tsx`.
- Vocabularies to respect when writing rows directly via Prisma (no DTO validation on
  the ingest path): `Stage`/`CompanyStatus`/`InvestorType`/`ExitType`/`Sector` in
  `packages/api/src/domain/company.ts`.

## What We're NOT Doing

- **No `/companies` pagination** — separate follow-up ticket (flagged; fund filter keeps
  volume sane for now).
- No `RoundInvestor` rows from Wikidata (it has no per-round data) and no funding
  rounds from Wikidata (amounts aren't modeled there reliably).
- No `DiversitySignal` ingestion, no `MarketStat` recomputation (stays seeded).
- No SEC 8-K/S-1 parsing (unstructured; poor ROI vs Wikidata) and no LinkedIn/Crunchbase
  scraping (ToS/licensing).
- No admin merge/dedupe tooling — dedupe is handled at ingest time by match-&-enrich.
- No changes to `apps/web` or `apps/api` (data flows through existing read paths).

## Implementation Approach

Four phases, each independently shippable and verifiable. Phase 1 fixes volume
(date-range + filters + amendment identity) and bootstraps jest for `apps/jobs`.
Phase 2 adds the provenance migration and extends the normalized record + upsert to
child entities, wired to Form D people. Phase 3 adds the Wikidata source with
match-&-enrich. Phase 4 wires source selection into cron/CLI/Makefile and documents
the local runbook.

Throughout: ingested rows stay **auto-APPROVED** (trusted sources), keyed by
`(externalSource, externalId)`.

---

## Phase 1: Date-Range Form D Backfill (volume fix)

### Overview
Walk N days of SEC daily indexes, skip pooled funds by default, give amendments a
stable round identity, and expose `DAYS`/`LIMIT`/`SKIP_FUNDS` knobs. Bootstrap jest.

### Changes Required:

#### 1. EdgarClient — date-range listing
**File**: `apps/jobs/src/sources/sec-edgar/edgar.client.ts`
**Changes**: Replace `listRecentFormD(target, lookbackDays)` with a range walker.
Keep `listFormDForDay`, `fetchPrimaryDoc`, throttle as-is.

```ts
/** All Form D/A refs filed in the last `days` calendar days (deduped by accession).
 *  Weekends are skipped locally; holidays return 404 and are skipped by fetchText. */
async listFormD(days: number): Promise<FormDRef[]> {
  const out: FormDRef[] = [];
  const seen = new Set<string>();
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - i);
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue; // no weekend indexes
    const refs = await this.listFormDForDay(day);
    if (refs.length) this.logger.log(`${refs.length} Form D refs for ${ymd(day)}`);
    for (const ref of refs) {
      if (!seen.has(ref.accession)) { seen.add(ref.accession); out.push(ref); }
    }
  }
  return out;
}
```

#### 2. Parser — fund flag + amendment identity
**File**: `apps/jobs/src/sources/sec-edgar/form-d.parser.ts`
**Changes**: Extend `ParsedFormD` with `isPooledFund`, `isAmendment`,
`previousAccession` (people extraction lands in Phase 2, keep this diff focused):

```ts
export interface ParsedFormD {
  // ...existing fields...
  isPooledFund: boolean;
  isAmendment: boolean;
  /** Accession of the filing this D/A amends, or null. */
  previousAccession: string | null;
}

// in parseFormD():
const isPooledFund = industry === 'Pooled Investment Fund';
const newOrAmendment = offering.typeOfFiling?.newOrAmendment ?? {};
const isAmendment = newOrAmendment.isAmendment === true || str(newOrAmendment.isAmendment) === 'true';
const previousAccession = str(newOrAmendment.previousAccessionNumber) || null;
```

#### 3. Source — range fetch, fund skip, amendment round key
**File**: `apps/jobs/src/sources/sec-edgar/sec-edgar.source.ts`
**Changes**: New `IngestionSource` contract (see #4). Skip funds when configured;
key amended rounds by the original accession:

```ts
async fetch(opts: FetchOptions): Promise<NormalizedRecord[]> {
  const refs = await this.client.listFormD(opts.days);
  const out: NormalizedRecord[] = [];
  let skippedFunds = 0;

  for (const ref of refs) {
    if (out.length >= opts.limit) break;
    const xml = await this.client.fetchPrimaryDoc(ref);
    if (!xml) continue;
    const parsed = parseFormD(xml);
    if (!parsed) continue;
    if (this.skipFunds && parsed.isPooledFund) { skippedFunds++; continue; }

    // Amendments update the original filing's round instead of duplicating it.
    const roundExternalId =
      parsed.isAmendment && parsed.previousAccession ? parsed.previousAccession : ref.accession;
    // ...build record as today, with roundExternalId...
  }
  this.logger.log(`Normalized ${out.length} filings (${skippedFunds} pooled funds skipped)`);
  return out;
}
```

`skipFunds` comes from `ConfigService`: `INGEST_SKIP_FUNDS` default `'true'`
(inject `ConfigService` into `SecEdgarSource`).

Note: chained amendments (D/A of a D/A) key to the *previous* accession, not the
chain root — at 90-day windows this at worst leaves one extra round per rare chain;
acceptable and idempotent.

#### 4. Ingestion contract — days + limit
**File**: `apps/jobs/src/sources/ingestion-source.ts`
**Changes**:

```ts
export interface FetchOptions {
  /** How many calendar days back to look (sources without a time axis may ignore it). */
  days: number;
  /** Max records to return. */
  limit: number;
}

export interface IngestionSource {
  readonly name: string;
  fetch(opts: FetchOptions): Promise<NormalizedRecord[]>;
}
```

Rename `NormalizedFiling` → **`NormalizedRecord`** (it stops being filing-specific in
Phase 2/3). Ripple: `ingestion-source.ts`, `sec-edgar.source.ts`, `ingest.service.ts`.

#### 5. IngestService / Scheduler / Backfill — thread the options
**Files**: `apps/jobs/src/ingest/ingest.service.ts`, `apps/jobs/src/ingest/ingest.scheduler.ts`,
`apps/jobs/src/backfill.ts`
**Changes**:
- `IngestService.run(opts: FetchOptions & { sources?: string[] })` — pass `opts` to each
  source's `fetch` (the `sources` filter is used in Phase 4; accept it now).
- Scheduler: `INGEST_DAYS` (default `'3'` — small idempotent catch-up window that rides
  out holidays), `INGEST_LIMIT` (default `'500'`).
- Backfill CLI: `node dist/backfill [days] [limit] [source]` —
  `days` default `90` (`INGEST_DAYS` env wins if set), `limit` default `100000`
  (effectively unbounded for local runs), `source` handled in Phase 4 (accept and
  ignore-with-log until then).

#### 6. Makefile + env
**Files**: `Makefile` (lines 4-5, 73-80), `apps/jobs/.env.example`
**Changes**:

```makefile
# Backfill window/limit (override: `make ingest DAYS=30 LIMIT=500`).
DAYS  ?= 90
LIMIT ?= 100000

ingest: ## Run a local backfill (DAYS=N LIMIT=N SOURCE=all|SEC_EDGAR|WIKIDATA)
	yarn workspace jobs build
	cd apps/jobs && node dist/backfill.js $(DAYS) $(LIMIT) $(SOURCE)
```
(`SOURCE ?= all`; `ingest-prod` gets the same args.)

`.env.example` adds:
```
# How many days of filings each scheduled ingest covers (idempotent catch-up window).
INGEST_DAYS="3"
# Skip pooled investment funds / SPVs (the majority of Form D filers). "false" to keep them.
INGEST_SKIP_FUNDS="true"
```
and bumps `INGEST_LIMIT` default comment to 500 (cron cap; backfill passes its own).

#### 7. Jest bootstrap for apps/jobs
**Files**: `apps/jobs/package.json`, `apps/jobs/jest.config.ts` (mirror `apps/api`'s
setup: `jest`, `ts-jest`, `@jest/globals`, `@repo/jest-config`), plus specs:
- `apps/jobs/src/sources/sec-edgar/form-d.parser.spec.ts` — fixture XML (operating co,
  pooled fund, D/A amendment): fund flag, previousAccession, existing field extraction.
- `apps/jobs/src/sources/sec-edgar/edgar.client.spec.ts` — `parseFormIndex` on a real
  index excerpt.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build` passes (turbo, all workspaces)
- [x] `yarn lint` passes (strict `--max-warnings 0`)
- [x] `yarn workspace jobs test` passes (new parser/index specs)

#### Manual Verification:
- [ ] `make ingest DAYS=7` completes; log shows multiple days of refs, "pooled funds
      skipped" count, and hundreds (not 50) processed
- [ ] Re-running the same command upserts (row counts stable, no duplicate rounds for
      D/A pairs): check `select count(*) from "FundingRound"` before/after
- [ ] Companies appear on the web directory; no fund-vehicle names like
      "... a Series of ... LLC" present

**Implementation Note**: pause here for manual confirmation before Phase 2.

---

## Phase 2: Child-Entity Provenance + People from Form D

### Overview
Migration adds `externalSource`/`externalId` to the four child tables; the normalized
record gains optional child collections; `IngestService` upserts them; the SEC source
emits people from `relatedPersonsList`.

### Changes Required:

#### 1. Prisma migration — provenance on child tables
**File**: `packages/db/prisma/schema.prisma`
**Changes**: Add to `Person`, `InvestorHolding`, `AcquisitionDeal`, `ExitEvent`
(exact pattern from `Company:73-92`):

```prisma
  // Provenance for ingested rows (e.g. SEC_EDGAR, WIKIDATA). Null for human contributions.
  externalSource String?
  externalId     String?

  @@unique([externalSource, externalId])
```

Run: `yarn workspace @repo/db migrate -- --name child-entity-provenance` then
`yarn workspace @repo/db generate`. (Nullable columns; Postgres treats NULL pairs as
distinct, so existing crowdsourced rows are unaffected — same semantics Company
already relies on.)

#### 2. NormalizedRecord — child collections
**File**: `apps/jobs/src/sources/ingestion-source.ts`
**Changes**:

```ts
export interface NormalizedPerson {
  externalId: string;   // stable within the source, e.g. `${cik}:person:${slug}`
  name: string;
  role: string;
  since: number;
  title?: string | null;
  linkedinUrl?: string | null;
}
export interface NormalizedInvestor {
  externalId: string;
  name: string;
  type: InvestorType;
  firstRound: string;   // 'Undisclosed' when unknown
  rounds: number;
}
export interface NormalizedAcquisition {
  externalId: string;
  target: string;
  date: string;         // ISO — required by schema; undated deals are dropped upstream
  amountUsd?: number | null;
  rationale: string;
}
export interface NormalizedExit {
  externalId: string;
  type: ExitType;
  date: string;
  valueUsd?: number | null;
  detail: string;
}

export interface NormalizedRecord {
  source: string;
  companyExternalId: string;
  company: { /* existing fields, plus: */
    // optional metadata a richer source may provide (all optional):
    domain?: string;
    websiteUrl?: string | null;
    linkedinUrl?: string | null;
    primarySector?: Sector | null;
    oneLiner?: string;
    description?: string;
    headcount?: number;
    status?: CompanyStatus;   // default 'Private'
  };
  round?: { externalId: string; name: string; date: string; amountUsd: number };
  people?: NormalizedPerson[];
  investors?: NormalizedInvestor[];
  acquisitions?: NormalizedAcquisition[];
  exits?: NormalizedExit[];
}
```

(`roundExternalId` folds into `round.externalId` since `round` is now optional.)

#### 3. Parser — related persons
**File**: `apps/jobs/src/sources/sec-edgar/form-d.parser.ts`
**Changes**: extract `relatedPersonsList.relatedPersonInfo` (single object **or**
array — normalize with a `toArray` helper):

```ts
export interface ParsedPerson { name: string; role: string; title: string | null }

// name = [firstName, middleName, lastName].filter(Boolean).join(' ')
// role = first relationship (e.g. 'Executive Officer'), title = relationshipClarification || null
// Skip entity-like entries (fund administrators file as "persons"):
const ENTITY_RE = /\b(llc|l\.l\.c\.?|lp|l\.p\.?|inc|ltd|corp|fund|capital|management|advis[oe]rs?|partners)\b/i;
```

#### 4. SEC source — emit people
**File**: `apps/jobs/src/sources/sec-edgar/sec-edgar.source.ts`
**Changes**: map `parsed.people` →
`{ externalId: `${ref.cik}:person:${kebab(name)}`, name, role, title, since: filingYear }`
where `filingYear = Number(ref.dateFiled.slice(0, 4))` (fallback: current year).
People are keyed by **CIK**, not accession, so D/A re-filings update rather than
duplicate.

#### 5. IngestService — upsert children
**File**: `apps/jobs/src/ingest/ingest.service.ts`
**Changes**: after the company upsert, make the round upsert conditional
(`if (r.round)`), then for each child collection upsert keyed
`(externalSource, externalId)`, `moderationStatus: 'APPROVED'`, `companyId: company.id`:

```ts
for (const p of r.people ?? []) {
  await this.prisma.person.upsert({
    where: { externalSource_externalId: { externalSource: r.source, externalId: p.externalId } },
    create: { companyId: company.id, name: p.name, role: p.role, since: p.since,
              title: p.title ?? null, linkedinUrl: p.linkedinUrl ?? null,
              externalSource: r.source, externalId: p.externalId, moderationStatus: 'APPROVED' },
    update: { role: p.role, title: p.title ?? null },
  });
}
// analogous blocks for investors / acquisitions / exits
```

#### 6. Tests
- `form-d.parser.spec.ts`: person extraction (single + array `relatedPersonInfo`),
  entity-name skipping, name assembly.
- New `ingest.service.spec.ts` (Prisma mocked): record with people/investors/exits →
  correct upsert calls; record without round → no round upsert.

### Success Criteria:

#### Automated Verification:
- [x] Migration applies cleanly: `yarn workspace @repo/db migrate` (dev DB)
- [x] `yarn build && yarn lint` pass
- [x] `yarn workspace jobs test` passes

#### Manual Verification:
- [ ] `make ingest DAYS=7` → Form D companies now show People on their profile pages
      (executives/directors, no "Sydecar LLC"-style administrator entries)
- [ ] Re-run is idempotent: `select count(*) from "Person"` stable across two runs
- [ ] Admin moderation queue does **not** fill with ingested rows (all APPROVED)

**Implementation Note**: pause here for manual confirmation before Phase 3.

---

## Phase 3: Wikidata Enrichment Source

### Overview
New `WIKIDATA` `IngestionSource`: pull the ~6.4k companies carrying `investor` (P1951)
statements, with metadata, investors, founders/CEOs, acquisitions, and exits, and
match-&-enrich existing rows (seeded demo + SEC) by normalized name/domain.

### Changes Required:

#### 1. Wikidata client
**File**: `apps/jobs/src/sources/wikidata/wikidata.client.ts`
**Changes**: `runQuery(sparql): Promise<SparqlBinding[]>` — GET
`https://query.wikidata.org/sparql?format=json&query=...`, `User-Agent` from
`SEC_USER_AGENT`-style env `WDQS_USER_AGENT` (fallback to `SEC_USER_AGENT` value),
throttle ≥1100 ms between requests, one retry with backoff on 429/timeout.

#### 2. Queries
**File**: `apps/jobs/src/sources/wikidata/wikidata.queries.ts`
**Changes**: pure query-builder functions. Seed query:

```sparql
SELECT DISTINCT ?company WHERE { ?company wdt:P1951 ?investor . }
```

Then batch QIDs in `VALUES` chunks of **200** across five detail queries
(all with `SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }`):

- **details**: `?companyLabel ?companyDescription`, `wdt:P856 ?website`,
  `wdt:P571 ?inception`, `wdt:P159 ?hq` (+label), `wdt:P17 ?country` (+label),
  `wdt:P452 ?industry` (+label), `wdt:P1128 ?employees`, `wdt:P4264 ?linkedinId` —
  all OPTIONAL; mapper dedupes multi-valued rows first-wins.
- **investors**: `?company wdt:P1951 ?investor` (+label).
- **people**: `{ ?company p:P112 ?st . ?st ps:P112 ?person . BIND("Founder" AS ?role) }
  UNION { ?company p:P169 ?st . ?st ps:P169 ?person . OPTIONAL { ?st pq:P580 ?start }
  BIND("CEO" AS ?role) }` (+labels).
- **acquisitions** (deals the company made): `?target p:P127 ?st . ?st ps:P127 ?company .
  ?st pq:P580 ?date .` (+target label; **date required** — undated ownership isn't a
  datable deal and `AcquisitionDeal.date` is non-null).
- **exits**: acquired → `?company p:P127 ?st . ?st ps:P127 ?acquirer . ?st pq:P580 ?date`
  (+acquirer label); IPO → `?company p:P793 ?st . ?st ps:P793 wd:Q184680 .
  ?st pq:P585 ?date` with `?company p:P414 ?st2 . ?st2 pq:P580 ?date` as fallback.

~6.4k companies / 200 per chunk × 5 query types ≈ 160 requests ≈ 3-4 min throttled.

#### 3. Mapper (pure, heavily tested)
**File**: `apps/jobs/src/sources/wikidata/wikidata.mapper.ts`
**Changes**: SPARQL bindings → `NormalizedRecord[]`. Rules (all decided):

- Skip companies whose English label is missing (label === bare QID).
- `companyExternalId` = QID. `domain` = hostname of `website` (strip `www.`), `''` if none.
  `websiteUrl` = website; `linkedinUrl` = `https://www.linkedin.com/company/${linkedinId}`.
- `founded` = year(inception) else 0; `headcount` = employees else 0;
  `hq` = `"City, Country"` parts joined else `'Undisclosed'`; `industry` = [industryLabel].
- `oneLiner` = capitalized `companyDescription` else
  `'${name} — profile sourced from Wikidata.'`; `description` templated from the fields.
- `primarySector` keyword heuristic on industry+description →
  `Artificial intelligence` | `Fintech` | `Healthcare` | `Climate` | `Enterprise SaaS`
  else null (small regex map; e.g. `/artificial intelligence|machine learning/`,
  `/fintech|financial|payment|bank/`, `/health|biotech|pharma|medical/`,
  `/climate|energy|solar|carbon/`, `/software|saas|cloud/`).
- `status`/`stage`: IPO exit → `'Public'`/`'Public'`; acquisition exit →
  `'Acquired'`/`'Acquired'`; else `'Private'`/`'Late stage'` (notable companies without
  round data — least-wrong default; enrichment never overwrites an existing stage).
- `totalRaisedUsd` = 0 (unknown — Wikidata has no reliable amounts).
- investors → `{ externalId: `${qid}:investor:${invQid}`, name, type: heuristic
  (label contains 'angel' → 'Angel'; 'private equity' → 'Private equity'; else
  'Venture'), firstRound: 'Undisclosed', rounds: 1 }`.
- people → `{ externalId: `${qid}:person:${personQid}:${role}`, name, role,
  since: startYear ?? foundedYear ?? currentYear }`.
- acquisitions → `{ externalId: `${qid}:acq:${targetQid}`, target, date,
  amountUsd: null, rationale: 'Acquisition recorded on Wikidata.' }`.
- exits → `{ externalId: `${qid}:exit:ipo` | `${qid}:exit:acq:${acquirerQid}`, type,
  date, valueUsd: null, detail: 'Initial public offering.' | `Acquired by ${acquirer}.` }`.
- No `round` — Wikidata contributes no funding rounds.

#### 4. Source + module registration
**Files**: `apps/jobs/src/sources/wikidata/wikidata.source.ts`,
`apps/jobs/src/ingest/ingest.module.ts`
**Changes**: `WikidataSource implements IngestionSource` (`name = 'WIKIDATA'`; ignores
`opts.days`, respects `opts.limit`). Register client+source in the module and append to
the `INGESTION_SOURCES` factory.

#### 5. IngestService — match & enrich
**File**: `apps/jobs/src/ingest/ingest.service.ts`
**Changes**: at the start of `run()`, preload a match index once:

```ts
const existing = await this.prisma.company.findMany({
  select: { id: true, name: true, domain: true, externalSource: true, externalId: true },
});
// byKey: Map<`${source}:${id}`, id>; byDomain: Map<domain, id>; byName: Map<normalizeName(name), id>
```

`normalizeName` (exported for tests): lowercase → strip punctuation → drop trailing
legal suffixes (`inc|incorporated|corp|corporation|llc|ltd|limited|co|company|plc|sa|ag`)
→ collapse whitespace.

In `upsert(record)`:
1. Row exists under `(record.source, companyExternalId)` → update as today.
2. Else match by domain, then normalized name → **enrich**: `update` that row filling
   **blank fields only** (`domain === ''`, `websiteUrl/linkedinUrl/primarySector` null,
   `founded === 0`, `headcount === 0`); replace `oneLiner`/`description` **only when
   they are the generic SEC placeholder text** (startsWith `'Private securities
   offering disclosed'` / contains `'filed a Form D'`). Never touch `name`, `stage`,
   `status`, `totalRaisedUsd`, or the row's own provenance keys. Child rows still
   attach with `WIKIDATA` provenance (idempotent on re-runs).
3. Else create keyed `(WIKIDATA, qid)`. Slug: try `kebab(name)`, on collision append
   `-${qid.toLowerCase()}` (find-unique loop, same idea as
   `apps/api/src/companies/companies.service.ts:283 uniqueSlug`).

Note: match-&-enrich applies to every source generically (SEC records simply rarely
match anything pre-existing by name; behavior for SEC stays effectively unchanged).

#### 6. Tests
- `wikidata.mapper.spec.ts`: fixture bindings → record shape; sector heuristic; QID-label
  skip; exit/status derivation; multi-valued dedupe.
- `wikidata.queries.spec.ts`: VALUES chunking (200/page), query text sanity.
- `ingest.service.spec.ts` additions: `normalizeName` cases ("Stripe, Inc." ≡ "stripe");
  enrich-fills-blanks-only; placeholder-only description replacement; new-company slug
  collision path.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build && yarn lint` pass
- [x] `yarn workspace jobs test` passes

#### Manual Verification:
- [ ] `make ingest SOURCE=WIKIDATA` completes in <10 min, logs ~6k records
- [ ] Stripe/OpenAI-tier profiles show investors, founders/CEO, exits where applicable;
      logos resolve (domains populated)
- [ ] A seeded demo company that also exists in Wikidata was **enriched**, not duplicated
      (search the directory for its name → one row)
- [ ] Re-run is idempotent (row counts stable)

**Implementation Note**: pause here for manual confirmation before Phase 4.

---

## Phase 4: Source Selection, Docs & Full Local Backfill

### Overview
Cron stays SEC-only by default; the backfill CLI can run any/all sources; docs and
Makefile reflect the new workflow. Finish with the real 90-day + Wikidata load.

### Changes Required:

#### 1. Source filter
**Files**: `apps/jobs/src/ingest/ingest.service.ts`, `ingest.scheduler.ts`, `backfill.ts`
**Changes**: `run(opts)` filters `this.sources` by `opts.sources` (names) when provided.
Scheduler passes `INGEST_SOURCES` env (comma-separated, default `'SEC_EDGAR'` — the
Wikidata set changes slowly; re-pull it manually or via a future monthly schedule).
Backfill's third positional arg: `all` (default) | `SEC_EDGAR` | `WIKIDATA`.

#### 2. Env + Makefile + docs
**Files**: `apps/jobs/.env.example`, `Makefile`, `CLAUDE.md` (Jobs section)
**Changes**:
- `.env.example`: `INGEST_SOURCES="SEC_EDGAR"` (+ comment that WIKIDATA is available),
  `WDQS_USER_AGENT` note (defaults to `SEC_USER_AGENT`).
- Makefile `help` text for `ingest`/`ingest-prod` documents `DAYS`/`LIMIT`/`SOURCE`.
- CLAUDE.md Jobs paragraph: mention the two sources, the fund filter, provenance-keyed
  child upserts, and `make ingest DAYS=N SOURCE=...`.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build && yarn lint && yarn workspace jobs test` pass

#### Manual Verification:
- [ ] Full local load: `make ingest` (90 days SEC + Wikidata) completes (~45 min);
      directory has thousands of companies; notable profiles are rich
- [ ] `yarn dev` web landing page still loads acceptably with the larger dataset
      (if sluggish, that's the flagged pagination follow-up — record actual counts)
- [ ] Worker boots normally (`make dev` or container): cron registered, SEC-only

---

## Testing Strategy

### Unit Tests (all pure functions, no network):
- Form D parsing: fund detection, amendment chain, related-person extraction &
  entity-name filtering, index parsing.
- Wikidata mapping: bindings → records, sector heuristic, status/stage derivation,
  externalId construction, VALUES chunking.
- Ingest logic (Prisma mocked): child upserts, optional round, match-&-enrich
  fill-blanks-only semantics, `normalizeName`.

### Integration Tests:
- None automated (live SEC/WDQS endpoints); covered by the manual `make ingest DAYS=7`
  smoke runs per phase.

### Manual Testing Steps:
1. Phase 1: `make ingest DAYS=7`, re-run, verify counts stable + no fund vehicles.
2. Phase 2: verify People sections on Form D company profiles; Person count stable
   across re-runs.
3. Phase 3: `make ingest SOURCE=WIKIDATA`; spot-check Stripe/OpenAI/SpaceX profiles;
   verify a seeded company was enriched not duplicated.
4. Phase 4: full `make ingest`; browse the site.

## Performance Considerations

- SEC: 90 days ≈ ~60 index fetches + ~14k `primary_doc.xml` fetches at ~6 req/s ≈
  **~40 min** local one-off. Fund-skip happens post-fetch (the index doesn't carry
  industry), so it reduces DB writes, not fetch time.
- WDQS: ~160 batched queries at ~1 req/s ≈ **~3-4 min**; chunk size 200 stays well
  under the 60 s query timeout.
- DB: upserts are row-at-a-time (matches existing style); ~5-6k companies + children is
  minutes, not hours. The preloaded match index is one query per run.
- Known follow-up: `/companies` returns all rows unpaginated — with fund filtering the
  payload stays in the low thousands; pagination is a separate ticket.

## Migration Notes

- One additive migration (4 tables × 2 nullable columns + unique index). No data
  backfill needed; existing crowdsourced child rows keep NULL provenance and are
  unaffected by the partial-unique semantics (NULLs are distinct in Postgres).
- Existing SEC-ingested companies/rounds keep their keys; the amendment-identity change
  only affects future D/A filings (past duplicates, if any, were within one day's window
  and effectively impossible under the old 50-cap).
- Rollback: revert migration (columns are nullable and unreferenced by apps/api).

## References

- Original ticket: `thoughts/shared/tickets/2026-07-15-job-scraper.md`
- Volume caps: `apps/jobs/src/sources/sec-edgar/edgar.client.ts:31`, `apps/jobs/src/backfill.ts:11`
- Upsert seam: `apps/jobs/src/ingest/ingest.service.ts:51`
- Source contract: `apps/jobs/src/sources/ingestion-source.ts:8`
- Provenance pattern to copy: `packages/db/prisma/schema.prisma:73-92` (Company)
- Vocabularies: `packages/api/src/domain/company.ts`
- Slug pattern: `apps/api/src/companies/companies.service.ts:283`
- Verified live: SEC daily index `form.20260713.idx` (230 Form D/A rows), sample
  `primary_doc.xml` (related persons, pooled-fund flag, `previousAccessionNumber`),
  WDQS P1951 counts (6,434 companies / 7,051 statements)
