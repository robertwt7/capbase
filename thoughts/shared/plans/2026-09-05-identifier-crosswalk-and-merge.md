# Identifier crosswalk + admin merge queue — Implementation Plan

> **Status: all nine phases implemented (2026-09-05).** Every Automated
> Verification box below has been run green; the Manual Verification boxes are
> left unchecked for the reviewer. Two clauses of this plan were **wrong and are
> corrected inline**, each marked "Corrected during implementation": the Wikidata
> ticker property direction (Phase 4) and the merge detector's name key
> (Phase 6). Both were caught by measuring rather than by reading.

## Overview

Give every `Company` and `Investor` a set of **external identifiers** (LEI, CIK, CRD,
Wikidata QID, OpenCorporates, ticker, UEI, DUNS) in one `EntityIdentifier` table, use
those identifiers as the strongest ingest match key, and add an **admin merge queue**
that surfaces candidate duplicate pairs, merges them behind a permanent slug redirect,
and can undo the merge.

## Current State Analysis

### Measured against the live local database (2026-09-05)

| table | rows |
|---|---|
| `Company` | 35,860 — SBIR 15,308 · SEC_FORM_C 8,778 · WIKIDATA 6,265 · SEC_EDGAR 5,277 · SEC_S1 223 · contributed 9 |
| `Investor` | 7,489 (6,720 with a CRD, 746 with a CIK, 68 from Wikidata) |
| `Fund` | 93,694 |
| `Revision` | 49 |

Identifier material already sitting in `externalId` and dedicated columns, unusable as a
join key because nothing indexes it as one:

| identifier | where it lives today | rows |
|---|---|---|
| CIK | `Company.externalId` for `SEC_EDGAR` / `SEC_FORM_C` / `SEC_S1` | 14,278 |
| CIK | `Investor.cikNumber` | 746 |
| CRD | `Investor.crdNumber` | 6,720 |
| Wikidata QID | `Company.externalId` / `Investor.externalId` where source = `WIKIDATA` | 6,333 |
| UEI | `Company.externalId` prefixed `uei:` (SBIR) | 14,227 |
| DUNS | `Company.externalId` prefixed `duns:` (SBIR) | 1,018 |
| domain | `Company.domain` / `Investor.domain` | 19,420 + n |

### Duplicates that exist right now

- **14 CIK groups / 28 company rows.** `Company` is unique on
  `@@unique([externalSource, externalId])` (`schema.prisma:171`), so
  `SEC_EDGAR:0001234567` and `SEC_FORM_C:0001234567` are two legal rows even though a
  CIK is *one filer*. This is the crosswalk's first prize and it is not reachable by any
  existing signal.
- **5 groups / 10 rows** colliding on a punctuation-stripped name that
  `normalizeName` (`ingest.service.ts:840`) misses.
- **0** duplicate domains and **0** duplicate CRDs. The domain-first matcher
  (`ingest.service.ts:694`) is working; the residue is exactly what shares neither a
  domain nor an exactly-equal normalized name.

### The company↔investor duality (a finding that shapes the schema)

Four domains, two CIKs and one QID are held by **a company row and an investor row at the
same time**:

| company | investor | domain |
|---|---|---|
| Wefunder | Wefunder | wefunder.com |
| Republic Core LLC | Republic Deal Room | republic.com |
| SHADOW ACCELERATOR LLC | Shadow Ventures, LLC | shadow.vc |
| Red Cell Partners, LLC | Red Cell Management, LLC | redcellpartners.com |

These are **not** duplicates. They are one organisation that both raises and invests, and
the model has no way to say so. A merge queue cannot merge across the two tables — they
have different pages, different vocabularies, different read paths. So a global
`@@unique([scheme, value])` (as the ticket phrases it) would fail on the very first
backfill run, on legitimate data.

### Existing admin surface

`AdminService` (`apps/api/src/admin/admin.service.ts`) has exactly two verbs — `moderate()`
and `applyProposal()` — and `AdminController` hardcodes `REVIEWABLE_TYPES`. There is no
merge primitive and no notion of an entity that used to exist.

### The constraint nobody has written down yet

If a merge **deletes** the losing row, it frees that row's `(externalSource, externalId)`
pair, and the next ingest run's `byKey` lookup misses — so the duplicate is recreated. The
loser therefore has to survive as a **tombstone** that both the slug redirect and the
ingest match index follow. This is not a nicety; it is what makes a merge stick. It also
delivers the ticket's "redirect from the losing slug" for free.

## Desired End State

- `EntityIdentifier` holds a normalized, validated, scheme-tagged identifier per
  `(company|investor)` row, unique **per entity type**, populated from stored provenance
  with no network access and thereafter written by every ingest source.
- `IngestService` matches **identifier → domain → normalized name**, and an identifier
  claimed by a second entity of the same type does not silently overwrite: it records a
  `MergeCandidate`.
- `/admin/merges` lists candidate pairs (strongest signal first) side by side; an admin
  picks the survivor and merges, or marks the pair "not a duplicate" and the detector
  stops proposing it.
- A merge moves every child row, remaps polymorphic `Citation`/`Revision` anchors,
  tombstones the loser, and writes a `MergeRecord` complete enough to **unmerge**.
- `/companies/<losing-slug>` and `/investors/<losing-slug>` answer **308 permanent
  redirect** to the survivor; the sitemap drops tombstones; every public read filters them
  out.
- Company and investor profiles render their identifiers as a mono meta block, linking out
  to EDGAR / IAPD / GLEIF / Wikidata / OpenCorporates / SAM.gov where a URL is derivable.

### Key Discoveries

- `packages/db/prisma/schema.prisma:118` — `Company` has **no** external identifier
  column at all; `Investor:274-275` has `crdNumber`/`cikNumber`; `Fund:335-338` has
  `secFundId`/`cikNumber`. A third identifiable type is clearly coming, which is why
  `EntityIdentifier` is polymorphic (`entityType` + `entityId`) like `Citation`
  (`schema.prisma:80-102`) rather than two nullable FKs.
- `apps/jobs/src/ingest/ingest.service.ts:694,613` — company and investor match order is
  `byKey` → `byDomain` → `byName`, with indexes preloaded once per run
  (`loadMatchIndex:217`, `loadInvestorIndex:238`). An identifier index slots in ahead of
  domain with no structural change.
- `apps/jobs/src/util/domain.ts:93` — `identifyingDomain` already rejects platform and
  social hosts. Sources keep calling it; `@repo/api` only gets the shape normalizer.
- `apps/jobs/src/sources/sec-edgar/edgar.urls.ts` and `.../wikidata/wikidata.urls.ts`
  are the single definitions of the IAPD and Wikidata URLs, explicitly so the client and
  the citation backfill "can never drift". The new `identifierUrl` must **not** become a
  third copy — those two delegate to it.
- `apps/api/src/companies/companies.service.ts:38-56` — `approvedChildren` already
  centralises the child filters, but the 14 `moderationStatus: 'APPROVED'` sites across
  `companies`/`investors`/`funds`/`users`/`market` services are hand-written. The
  tombstone filter is added once, as shared constants, rather than 14 times by hand.
- `apps/web/app/companies/[slug]/history/page.tsx:151,161` — the timeline renders
  `action === 'CREATE'` as "added" and everything else as "— field changed" with a
  before/after row. A new `MERGE` action needs an explicit branch or it renders nonsense.
- `apps/web/lib/data.ts:516` — `getCompanyDetail` is wrapped in React `cache()` and has
  **8 call sites**; `getInvestor` has 2. Calling `permanentRedirect()` *inside* those two
  functions costs zero call-site changes.
- `packages/api` has no test script; `packages/jest-config`'s `nestConfig` (rootDir `src`,
  ts-jest, node env) fits it unchanged, the way `apps/jobs/jest.config.js` uses it.

## What We're NOT Doing

- **No GLEIF full-index import and no OpenCorporates bulk CSV.** GLEIF publishes no
  domain, so matching its ~2.5M records to our corpus is legal-name fuzzy matching —
  precisely the heuristic the merge queue exists to clean up after. The `LEI` and
  `OPENCORPORATES` schemes ship and accept values; the bulk seed is its own ticket. What
  we do take is the *exact* route: Wikidata's P1278 (LEI), P5531 (CIK) and P249 (ticker),
  which are structured statements on entities we already ingest.
- **No fund merging.** 93,694 rows whose names collide degenerately (`fund 5`, `94` —
  measured 191 collisions in the ADV set) would swamp the queue, and funds have no page to
  redirect. `IDENTIFIABLE_TYPES` stays `company | investor`.
- **No cross-type merging.** The four company↔investor pairs above are one organisation
  with two roles; recording that link is a separate ticket. This plan makes the duality
  *visible* (both sides carry the same CIK/domain) without acting on it.
- **No holding-level dedupe.** Two `InvestorHolding` rows for the same (company, firm)
  pair are already possible today from two sources; an investor merge remaps `investorId`
  and leaves them alone. Collapsing them would make the merge irreversible, which the
  chosen undo semantics forbid.
- **No identifier contribution form.** Identifiers arrive from ingest, backfill, and an
  admin. A public "add an LEI" form is a moderation-queue change and is out of scope.
- **No `Company.domain` / `Investor.domain` column removal.** `DOMAIN` becomes an
  identifier scheme alongside them, and the backfill keeps the two in sync; collapsing the
  column is a separate migration with a large blast radius (logo resolution, list
  selects, `CompanySummary`).

## Implementation Approach

Nine phases. Phase 1 is the only migration — all three schema changes ship together so
phases 2–9 are pure code and each is independently shippable and verifiable.

The identifier-collision signal is **not** a batch scan: with per-type uniqueness a
collision can never land in the table, so the moment of the failed write *is* the
detection, and that is where the `MergeCandidate` is recorded. Only the weaker
domain/name signals need a sweep.

---

## Phase 1: Vocabulary, normalizers, and schema

### Overview
Everything the later phases write against: the identifier vocabulary and its validating
normalizers in `@repo/api`, and one Prisma migration carrying `EntityIdentifier`,
`MergeCandidate`, `MergeRecord`, and the `mergedIntoId` tombstone columns.

### Changes Required:

#### 1. Identifier vocabulary + normalizers
**File**: `packages/api/src/domain/identifiers.ts` (new)

Plain TypeScript, no runtime deps, matching the `Sector`/`FundStrategy` convention
(string-literal union + `readonly` const array, stored as a plain `String` column and
validated in DTOs with `@IsIn([...])`).

```ts
export type IdentifierScheme =
  | 'LEI'            // GLEIF Legal Entity Identifier (ISO 17442)
  | 'CIK'            // SEC Central Index Key
  | 'CRD'            // FINRA/IAPD Central Registration Depository number
  | 'WIKIDATA'       // QID
  | 'OPENCORPORATES' // "<jurisdiction>/<number>", e.g. us_de/1234567
  | 'TICKER'         // exchange-qualified, "NASDAQ:ABNB"
  | 'UEI'            // SAM.gov Unique Entity ID
  | 'DUNS'           // Dun & Bradstreet number
  | 'DOMAIN';        // identifying host (see apps/jobs/src/util/domain.ts)

export const IDENTIFIER_SCHEMES: readonly IdentifierScheme[] = [...];

/** What an identifier can point at. Funds are excluded on purpose: they are
 *  ingest-only, have no page, and their names collide degenerately. */
export type IdentifiableType = 'company' | 'investor';
export const IDENTIFIABLE_TYPES: readonly IdentifiableType[] = ['company', 'investor'];

/**
 * Canonical form of a raw identifier, or null when it does not match the
 * scheme's shape. Null is load-bearing: a malformed CIK that entered the
 * crosswalk would join two unrelated entities, so a value we cannot validate is
 * dropped rather than stored.
 */
export function normalizeIdentifier(scheme: IdentifierScheme, raw: string): string | null;

/** A public page for the identifier, or null when the issuer publishes none
 *  (DUNS is paywalled; a bare ticker has no neutral canonical page). */
export function identifierUrl(scheme: IdentifierScheme, value: string): string | null;

export interface EntityIdentifierRef {
  scheme: IdentifierScheme;
  value: string;
  /** Derived, not stored — `identifierUrl(scheme, value)`. */
  url: string | null;
}
```

Normalization rules, one per scheme:

| scheme | canonical form | rejected |
|---|---|---|
| `CIK` | digits only, zero-padded to 10 (`0001234567`) | non-digits, >10 digits, all zeros |
| `CRD` | digits, leading zeros stripped | non-digits, empty |
| `LEI` | uppercase, `^[0-9A-Z]{18}[0-9]{2}$` **and** the ISO 17442 mod-97-10 check digits | bad length, bad checksum |
| `WIKIDATA` | `^Q[1-9][0-9]*$` | `P…`/`L…` ids, lowercase noise |
| `OPENCORPORATES` | `<lowercase jurisdiction>/<number>` | missing slash |
| `TICKER` | `EXCHANGE:SYMBOL`, both uppercased | no exchange qualifier — an unqualified ticker is not an identifier |
| `UEI` | 12 uppercase alnum, excluding letters `I` and `O` (SAM's alphabet) | wrong length, `I`/`O` present |
| `DUNS` | 9 digits, zero-padded | non-digits, >9 digits |
| `DOMAIN` | lowercase host, `www.` stripped, must contain a dot | anything without a dot |

The LEI checksum is validated because LEIs reach us through Wikidata, where anyone can
type one; the other schemes are shape-checked only.

`identifierUrl`: CIK → `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=<v>`;
CRD → `https://adviserinfo.sec.gov/firm/summary/<v>`; LEI →
`https://search.gleif.org/#/record/<v>`; WIKIDATA → `https://www.wikidata.org/wiki/<v>`;
OPENCORPORATES → `https://opencorporates.com/companies/<v>`; UEI →
`https://sam.gov/entity/<v>`; DOMAIN → `https://<v>`; TICKER and DUNS → `null`.

**File**: `packages/api/src/entry.ts` — add `export * from './domain/identifiers';`.

**Files**: `apps/jobs/src/sources/sec-edgar/edgar.urls.ts`,
`apps/jobs/src/sources/wikidata/wikidata.urls.ts` — `advFirmUrl` and
`wikidataEntityUrl` delegate to `identifierUrl` so the IAPD and Wikidata URLs keep exactly
one definition, as their existing header comments require.

#### 2. Tests for the normalizers
**Files**: `packages/api/jest.config.js`, `packages/api/src/domain/identifiers.spec.ts` (new)

`packages/api` has no test runner today. Add one mirroring `apps/jobs/jest.config.js`:

```js
// Plain JS (not .ts) so jest can parse the config without needing ts-node,
// which isn't hoisted to the workspace root.
const { nestConfig } = require('@repo/jest-config');
module.exports = nestConfig;
```

plus `"test": "jest"` and the `jest` / `ts-jest` / `@types/jest` devDeps in
`packages/api/package.json`. `turbo test` picks the workspace up with no config change.

Spec covers: every scheme's happy path, every rejection in the table above, LEI checksum
(a real LEI passes, the same string with one digit changed fails), idempotence
(`normalize(normalize(x)) === normalize(x)`), and `identifierUrl` returning `null` for
`TICKER`/`DUNS`.

#### 3. Prisma schema + one migration
**File**: `packages/db/prisma/schema.prisma`

```prisma
/// An external identifier for one Company or Investor — the crosswalk that lets
/// our rows be joined to anything else, and the strongest signal that two of our
/// rows are the same entity.
model EntityIdentifier {
  id     String @id @default(cuid())
  /// One of IDENTIFIER_SCHEMES.
  scheme String
  /// Canonical form, per normalizeIdentifier(). Values that fail validation are
  /// never stored — a malformed identifier joins unrelated entities.
  value  String
  /// One of IDENTIFIABLE_TYPES. Polymorphic like Citation: Fund already carries
  /// secFundId/cikNumber, so a third identifiable type is coming, and a typed FK
  /// per entity would mean a migration to admit it.
  entityType String
  entityId   String
  /// Where the identifier came from: an ingest source name, 'BACKFILL', or 'ADMIN'.
  source    String
  createdAt DateTime @default(now())

  /// Unique PER TYPE, not globally. Measured on the live corpus: four domains,
  /// two CIKs and one QID are held by a company row AND an investor row at once
  /// (Wefunder, Republic, Shadow, Red Cell) — one organisation that both raises
  /// and invests. Those are legitimate, so global uniqueness would reject real
  /// data. Within one type a shared identifier IS a duplicate, and that is what
  /// this constraint catches.
  @@unique([scheme, value, entityType])
  @@index([entityType, entityId])
}

/// A pair of same-type rows that look like the same entity, awaiting an admin
/// decision. Kept after the decision so a rejected pair is never re-proposed.
model MergeCandidate {
  id         String @id @default(cuid())
  entityType String
  /// The two rows, ordered so leftId < rightId — the @@unique then catches the
  /// pair whichever way round the detector found it.
  leftId  String
  rightId String
  /// One of MERGE_SIGNALS ('identifier' | 'domain' | 'name'), strongest first.
  signal String
  /// The value that matched ('CIK:0001234567', 'acme.com'), so the reviewer can
  /// check the proposal instead of guessing why it was made.
  evidence String
  /// One of MERGE_STATUSES: PENDING | MERGED | REJECTED.
  status      String    @default("PENDING")
  decidedAt   DateTime?
  decidedById String?
  decidedBy   User?     @relation(fields: [decidedById], references: [id], onDelete: SetNull)
  createdAt   DateTime  @default(now())

  @@unique([entityType, leftId, rightId])
  @@index([status, entityType])
}

/// What one merge moved, complete enough to reverse it.
model MergeRecord {
  id         String @id @default(cuid())
  entityType String
  survivorId String
  losingId   String
  /// { rounds: [...ids], people: [...], savedCompanies: [{userId, createdAt}],
  ///   identifiers: [{scheme, value, source}], ... } — moved ids plus the full
  /// content of rows the merge had to DELETE (unique-constraint collisions),
  /// since an unmerge must recreate those rather than move them back.
  moved       Json
  candidateId String?
  mergedAt    DateTime @default(now())
  mergedById  String?
  mergedBy    User?    @relation(fields: [mergedById], references: [id], onDelete: SetNull)
  /// Set when an admin reversed the merge. The record is kept either way: it is
  /// the audit trail for both directions.
  unmergedAt   DateTime?
  unmergedById String?

  @@index([entityType, survivorId])
  @@index([losingId])
}
```

On **both** `Company` and `Investor`:

```prisma
  /// Set when an admin merged this row into another. The row is KEPT, not
  /// deleted: its slug still redirects, and its (externalSource, externalId)
  /// still absorbs the source's next re-ingest. Deleting it would free that key
  /// and the very next ingest run would recreate the duplicate.
  mergedIntoId String?
  mergedInto   Company?  @relation("CompanyMerge", fields: [mergedIntoId], references: [id], onDelete: SetNull)
  mergedFrom   Company[] @relation("CompanyMerge")

  @@index([mergedIntoId])
```

`User` gains `mergeDecisions MergeCandidate[]` and `merges MergeRecord[]` back-relations.

**File**: `packages/api/src/domain/moderation.ts` — add the merge vocabularies and shapes
next to the existing moderation ones:

```ts
export type MergeSignal = 'identifier' | 'domain' | 'name';
export const MERGE_SIGNALS: readonly MergeSignal[] = ['identifier', 'domain', 'name'];

export type MergeStatus = 'PENDING' | 'MERGED' | 'REJECTED';
export const MERGE_STATUSES: readonly MergeStatus[] = ['PENDING', 'MERGED', 'REJECTED'];

/** One candidate pair, with both sides rendered enough to decide on. */
export interface MergeCandidateItem {
  id: string;
  entityType: IdentifiableType;
  signal: MergeSignal;
  evidence: string;
  status: MergeStatus;
  createdAt: string;
  left: MergeSide;
  right: MergeSide;
}

/** One side of a candidate: identity, the fields a reviewer diffs, and the
 *  child counts that usually decide which row survives. */
export interface MergeSide {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  hq: string | null;
  externalSource: string | null;
  externalId: string | null;
  createdAt: string;
  identifiers: EntityIdentifierRef[];
  /** rounds/people/investors/… for a company; holdings/funds for an investor. */
  counts: Record<string, number>;
}

export interface MergeQueueResponse {
  total: number;
  countsBySignal: Record<MergeSignal, number>;
  items: MergeCandidateItem[];
}
```

**File**: `packages/api/src/domain/provenance.ts` — widen the revision action:

```ts
export type RevisionAction = 'CREATE' | 'UPDATE' | 'MERGE' | 'UNMERGE';
```

Migration name: `add_entity_identifier_and_merge`.

### Success Criteria:

#### Automated Verification:
- [x] Migration applies cleanly: `make db-migrate`
- [x] Client regenerates: `make db-generate`
- [x] Everything builds: `yarn build`
- [x] Normalizer specs pass: `yarn workspace @repo/api test`
- [x] Whole suite passes: `make test`
- [x] Lint clean at `--max-warnings 0`: `make lint`
- [x] A prod-style rebuild still works: `make db-verify-fresh`

#### Manual Verification:
- [ ] `\d "EntityIdentifier"` in `psql` shows the unique index on `(scheme, value, entityType)` and no global one on `(scheme, value)`
- [ ] Inserting the same `(CIK, 0001234567, company)` twice fails; the same value under `entityType='investor'` succeeds

**Implementation Note**: pause here for manual confirmation before Phase 2.

---

## Phase 2: Backfill identifiers from stored provenance

### Overview
Populate `EntityIdentifier` from what the database already holds, with **no network
access**, the way `backfill-citations.ts` constructs every URL from stored identifiers.
Collisions are recorded as `MergeCandidate` rows rather than dropped.

### Changes Required:

#### 1. The backfill CLI
**File**: `apps/jobs/src/backfill-identifiers.ts` (new)

Modelled on `backfill-sectors.ts` (keyset pagination, `NestFactory.createApplicationContext`,
progress log every batch).

Company derivations:
- `externalSource ∈ {SEC_EDGAR, SEC_FORM_C, SEC_S1}` → `CIK` from `externalId` (~14,278)
- `externalSource = WIKIDATA` → `WIKIDATA` from `externalId` (~6,265)
- `externalSource = SBIR` → `UEI` from an `uei:`-prefixed `externalId` (~14,227), `DUNS`
  from a `duns:`-prefixed one (~1,018); a `name:`-prefixed key yields nothing, which is
  correct — a normalized name is not an identifier
- `domain <> ''` → `DOMAIN` (~19,420)

Investor derivations: `crdNumber` → `CRD` (~6,720); `cikNumber` → `CIK` (~746);
`externalSource = WIKIDATA` → `WIKIDATA` (~68); `domain` → `DOMAIN`.

Every value goes through `normalizeIdentifier`; a value that fails validation is **counted
and skipped**, never stored — the same rule `backfill-citations.ts` applies to rows with no
derivable URL. `source: 'BACKFILL'`.

#### 2. The shared writer
**File**: `apps/jobs/src/ingest/identifier.writer.ts` (new)

One function used by both this backfill and Phase 3's ingest path, so the two can never
drift on collision handling:

```ts
/**
 * Record one identifier for an entity.
 *
 * Returns 'written' | 'unchanged' | 'skipped' (failed validation) | 'conflict'.
 * A conflict — the (scheme, value, entityType) is already held by a DIFFERENT
 * entityId — is exactly the duplicate this whole ticket is about, so it does not
 * overwrite and it does not throw: it upserts a MergeCandidate and returns.
 */
export async function writeIdentifier(
  prisma: PrismaClientLike,
  args: { scheme: IdentifierScheme; value: string; entityType: IdentifiableType;
          entityId: string; source: string },
): Promise<IdentifierOutcome>;

/** Upsert a candidate pair, ids canonically ordered. An existing row is upgraded
 *  to a stronger signal but never downgraded, and a pair already MERGED or
 *  REJECTED is left alone — a rejected pair must never be re-proposed. */
export async function recordCandidate(
  prisma: PrismaClientLike,
  args: { entityType: IdentifiableType; aId: string; bId: string;
          signal: MergeSignal; evidence: string },
): Promise<void>;
```

#### 3. Make target + rebuild docs
**File**: `Makefile` — `backfill-identifiers` and `backfill-identifiers-prod`, mirroring
the `backfill-citations` pair; add `node dist/backfill-identifiers.js` to `ingest-all`
**before** `backfill-citations`.

**File**: `docs/DATA_REBUILD.md` — document the new step and its ordering.

#### 4. Tests
**File**: `apps/jobs/src/ingest/identifier.writer.spec.ts` (new) — pure spec against a
mocked Prisma client: a fresh write, an idempotent re-write, a validation skip, a
conflict producing exactly one candidate with canonically ordered ids, a second conflict
on the same pair not producing a second candidate, and a `REJECTED` pair not being
resurrected.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `yarn workspace jobs test`
- [x] `make lint`
- [x] `make backfill-identifiers` runs to completion and logs written/skipped/conflict counts
- [x] Re-running `make backfill-identifiers` writes 0 new rows (idempotent)

#### Manual Verification:
- [ ] `select scheme, count(*) from "EntityIdentifier" group by 1` roughly matches the coverage table above (CIK ≈ 15k across both types, UEI ≈ 14.2k, WIKIDATA ≈ 6.3k, CRD ≈ 6.7k, DOMAIN ≈ 20k+)
- [ ] `select * from "MergeCandidate" where signal='identifier'` contains the 14 known CIK pairs
- [ ] No candidate pairs a company id with an investor id

**Implementation Note**: pause here for manual confirmation before Phase 3.

---

## Phase 3: Identifiers as the ingest match key

### Overview
Sources emit the identifiers they know structurally; `IngestService` matches on them
first, ahead of domain, and writes them after every upsert.

### Changes Required:

#### 1. The source contract
**File**: `apps/jobs/src/sources/ingestion-source.ts`

```ts
/** An external identifier a source knows structurally. Sources emit only what
 *  the document actually states — never an identifier inferred from a name. */
export interface SourceIdentifier {
  scheme: IdentifierScheme;
  /** Raw; the writer normalizes and validates before storing. */
  value: string;
}
```

Added as `identifiers?: SourceIdentifier[]` to `NormalizedRecord['company']` and to
`NormalizedInvestorFirm`.

#### 2. Sources emit them
- `sec-edgar.source.ts:121` → `{ scheme: 'CIK', value: ref.cik }`
- `sec-form-c.source.ts:141` → `{ scheme: 'CIK', value: cik }`
- `sec-s1.source.ts:112` → `{ scheme: 'CIK', value: cik }`
- `sbir.parser.ts:129` → `UEI` or `DUNS`, parsed from the `firmKey` prefix
- `adv.parser.ts:146-156` → `{ CRD: crd }` and, when present, `{ CIK: cik }`
- `wikidata.mapper.ts:97` → `{ WIKIDATA: qid }` (Phase 4 adds LEI/CIK/ticker)

Each source keeps calling `identifyingDomain` before emitting a `domain`; the `DOMAIN`
identifier is derived from the stored column by `IngestService`, not emitted separately,
so the platform-host rules stay in one place.

#### 3. The match index
**File**: `apps/jobs/src/ingest/ingest.service.ts`

`MatchIndex` and `InvestorIndex` each gain `byIdentifier: Map<string, string>` keyed
`${scheme}:${value}`, loaded in `loadMatchIndex`/`loadInvestorIndex` from one
`entityIdentifier.findMany({ where: { entityType } })`.

`upsertCompany` (`:686`) and `upsertInvestorFirm` (`:600`) match:

```ts
// Identifier first: a CIK or a QID is a statement by the publisher about which
// entity this is. Domain is a strong inference and a name is a weak one, so
// both stay behind it.
const matchId =
  identifierMatch(c.identifiers, index) ??
  (c.domain ? index.byDomain.get(c.domain) : undefined) ??
  index.byName.get(normalizeName(c.name));
```

`identifierMatch` normalizes each candidate identifier and returns the first hit; two
identifiers on one record pointing at **different** existing entities is itself a
duplicate signal — it records a candidate and falls through to the first hit, rather than
picking arbitrarily and silently.

After every company/investor upsert (own-key, enrich, or create), each emitted identifier
plus the row's `domain` goes through `writeIdentifier`, and the in-memory index is updated
so a later record in the same run matches without a re-query — the pattern the existing
`byDomain`/`byName` writes already follow (`:718-724`).

#### 4. Tests
**File**: `apps/jobs/src/ingest/ingest.service.spec.ts` — added cases: a record whose CIK
matches an existing row enriches it instead of creating a second; identifier beats a
conflicting domain match; a record whose identifier is claimed by a different entity does
not overwrite and produces a candidate; a record with no identifiers still falls back to
domain then name exactly as before.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `yarn workspace jobs test` (existing ingest specs still pass unchanged)
- [x] `make lint`
- [x] A bounded live run writes identifiers: `make ingest DAYS=7 LIMIT=50 SOURCE=SEC_EDGAR`

#### Manual Verification:
- [x] The run's log reports identifiers written and any conflicts
- [x] Re-running the same window creates no new companies and no new identifiers
- [x] Spot-check one ingested company: its `EntityIdentifier` CIK row matches its `externalId`

**Implementation Note**: pause here for manual confirmation before Phase 4.

---

## Phase 4: Wikidata LEI, CIK and ticker

### Overview
The exact, structured route to the identifiers we cannot derive: three more properties on
a SPARQL query we already run.

### Changes Required:

#### 1. The query
**File**: `apps/jobs/src/sources/wikidata/wikidata.queries.ts`

`detailsQuery` gains three OPTIONAL clauses, and the header comment's property list is
extended (it is the file's documented contract):

```sparql
  OPTIONAL { ?company wdt:P1278 ?lei . }
  OPTIONAL { ?company wdt:P5531 ?cik . }
  OPTIONAL { ?company p:P414 ?listingSt .
             ?listingSt ps:P414 ?exchange .
             ?listingSt pq:P249 ?ticker . }
```

The ticker is read through the **qualified** statement so the exchange comes with it: a
bare symbol is not an identifier (`AAPL` on two exchanges is two instruments), which is
why `normalizeIdentifier('TICKER', …)` rejects an unqualified value.

**Corrected during implementation.** This plan originally specified `p:P249` with a
`pq:P414` qualifier; that returns zero rows. Checked against the live endpoint, Wikidata
models it the other way round — the **exchange** is the statement (P414) and the ticker is
its qualifier (pq:P249). Apple's AAPL/6689 and Tesla's TSLA/TL0/0R0X all sit this way, and
it matches the direction `exitsQuery` already reads listings from.

`investorFirmsQuery` gains `P1278` and `P5531` on the same pattern.

#### 2. The mapper
**File**: `apps/jobs/src/sources/wikidata/wikidata.mapper.ts`

`mapWikidata` collects identifiers per QID. `detailsQuery` returns one row per value of
each multi-valued property and the mapper already deduplicates first-wins (`:60-63`) — so
identifiers are accumulated **across** the repeated rows for a QID before the record is
built, rather than read off the first row only. The exchange label resolves through the
existing `LABEL_SERVICE`; a ticker whose exchange has no English label is dropped.

**File**: `apps/jobs/src/sources/wikidata/wikidata.queries.spec.ts` and
`wikidata.mapper.spec.ts` — assert the new clauses are present, and that a fixture with
two ticker statements on two exchanges yields two `TICKER` identifiers while a fixture
with an unqualified ticker yields none.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `yarn workspace jobs test`
- [x] `make lint`
- [x] A bounded live run: `make ingest DAYS=1 LIMIT=200 SOURCE=WIKIDATA`

#### Manual Verification:
- [ ] `select scheme, count(*) from "EntityIdentifier" where source='WIKIDATA' group by 1` shows LEI, CIK and TICKER rows
- [ ] Two or three LEIs spot-checked against `search.gleif.org` resolve to the right company
- [ ] Any CIK collision the run produced landed in `MergeCandidate`, not on top of an existing row

**Implementation Note**: pause here for manual confirmation before Phase 5.

---

## Phase 5: Identifiers on the public surface

### Overview
Make the crosswalk readable. Identifiers ride along in the two detail responses and render
as a mono meta block, each linking out where the issuer publishes a page.

### Changes Required:

#### 1. Domain types
**File**: `packages/api/src/domain/company.ts` — `Company` gains
`identifiers?: EntityIdentifierRef[]`.
**File**: `packages/api/src/domain/investor.ts` — `Investor` gains the same.

#### 2. API
**File**: `apps/api/src/provenance/identifier.mapper.ts` (new) — `toEntityIdentifier(row)`,
attaching `identifierUrl(scheme, value)`. Sits beside `citation.mapper.ts`, which is the
same shape of job.

**Files**: `apps/api/src/companies/companies.service.ts` (`getCompanyDetail`) and
`apps/api/src/investors/investors.service.ts` (`findOne`) — one
`entityIdentifier.findMany({ where: { entityType, entityId } })` each, ordered by
`IDENTIFIER_SCHEMES` position so the block is stably ordered across rows rather than by
insertion. `DOMAIN` is filtered out of the response: the profile already renders the
website link, and repeating the host as an "identifier" is noise.

Detail reads only — the directory list endpoints stay untouched, so no extra query lands
on a 24-row page.

#### 3. Web
**File**: `apps/web/components/Identifiers.tsx` (new)

A mono meta row per the design system — uppercase tracked scheme label in
`font-mono`, value in `font-mono text-ink`, wrapped in an `<a>` when `url` is non-null.
Built from existing primitives and Tailwind utilities; no CSS Module. Strictly graphite,
no accent.

**Files**: `apps/web/app/companies/[slug]/page.tsx` and
`apps/web/app/investors/[slug]/page.tsx` — render `<Identifiers>` in the facts panel,
below the existing outbound links. Renders nothing when the list is empty rather than an
empty-state box: an absent identifier is not an invitation to contribute one (there is no
form for it).

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `make test`
- [x] `make lint`
- [x] `curl -s localhost:3000/companies/<slug> | jq '.company.identifiers'` returns the expected array

#### Manual Verification:
- [ ] A SEC-sourced company profile shows `CIK` linking to a working EDGAR page
- [ ] A Wikidata company shows `WIKIDATA` (and LEI/ticker where present)
- [ ] An ADV investor profile shows `CRD` linking to a working IAPD page
- [ ] A company with no identifiers renders no empty block and no layout shift
- [ ] The block reads correctly in the dark/light-agnostic monochrome palette; the mono numerals line up

**Implementation Note**: pause here for manual confirmation before Phase 6.

---

## Phase 6: Merge candidate detection (domain + name)

### Overview
The identifier signal is already caught inline by `writeIdentifier` (Phase 2). This phase
adds the two weaker signals, which need a sweep.

### Changes Required:

#### 1. The detector CLI
**File**: `apps/jobs/src/detect-merges.ts` (new)

- **Domain.** `GROUP BY domain HAVING count(*) > 1` over `Company` and over `Investor`,
  separately, ignoring empty domains and tombstoned rows. Measured 0 today — but `enrich`
  (`ingest.service.ts:727`) fills a blank `domain` without checking global uniqueness, so
  the sweep is what catches the ones it creates.
- **Name.** The key is TypeScript, not SQL, so this streams `{ id, name }` for both
  tables (35,860 + 7,489 rows — a few MB) and groups in memory. Groups larger than a
  threshold (default 8) are **skipped and logged**, not emitted: a normalized name shared
  by nine rows is a generic string, not nine duplicates, and flooding the queue with them
  is how a moderation queue dies.

  **Corrected during implementation.** This plan originally keyed the sweep on
  `normalizeName` — the function `upsertCompany` itself matches on. That makes the sweep
  dead code: any pair it can find, ingest would already have merged at write time.
  Measured on the live corpus it finds **0** groups. The detector needs a key *looser* than
  the matcher's, and the gap is exactly the one this plan's own Current State analysis
  reported: `normalizeName` **deletes** punctuation, so `HeavyTech,Inc.` becomes
  `heavytechinc` and never meets `HeavyTech, Inc.` → `heavytech`. Keying on
  `normalizeInvestorName` — which replaces punctuation with a space, is already tested, and
  whose extra legal suffixes are legal suffixes on a company too — yields the **5 groups /
  10 rows** the analysis measured. For investors that function *is* the matcher's key, so
  that sweep finds nothing today and stays only as a cheap net for rows renamed after
  creation.

Both write through `recordCandidate`, so ordering, signal upgrading and the
already-decided guard are shared with the identifier path.

#### 2. Make target
**File**: `Makefile` — `merge-candidates` / `merge-candidates-prod`, appended to
`ingest-all` after `backfill-identifiers`.

#### 3. Tests
**File**: `apps/jobs/src/detect-merges.spec.ts` (new) — the pure grouping function:
groups of exactly 2 emit one pair; a group of 3 emits all 3 pairs; a group over the
threshold emits none; tombstoned rows are excluded; a pair already `REJECTED` is not
re-emitted.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `yarn workspace jobs test`
- [x] `make lint`
- [x] `make merge-candidates` runs and logs a per-signal count
- [x] Re-running writes no new candidates

#### Manual Verification:
- [ ] The 5 known punctuation-only name pairs appear with `signal='name'`
- [ ] The 14 known CIK pairs are present with `signal='identifier'` and were **not** downgraded by the name pass
- [ ] Spot-check five `name` candidates by hand — if more than one is obviously wrong, raise the group threshold before shipping the UI

**Implementation Note**: pause here for manual confirmation before Phase 7.

---

## Phase 7: Merge execution and unmerge

### Overview
The transactional primitive: move every child, remap the polymorphic anchors, tombstone
the loser, and record enough to reverse it.

### Changes Required:

#### 1. The service
**File**: `apps/api/src/admin/merge/merge.service.ts` (new)

`merge(entityType, candidateId | pair, survivorId, adminUserId)` in one
`prisma.$transaction`:

**Company merge**
1. Guard: both rows exist, same type, neither already has `mergedIntoId` set, survivor is
   one of the pair.
2. `updateMany({ where: { companyId: loser } , data: { companyId: survivor } })` for
   `FundingRound`, `Person`, `InvestorHolding`, `AcquisitionDeal`, `ExitEvent`,
   `DiversitySignal`, `ChangeProposal`. None of these can violate a unique key: their
   `@@unique([externalSource, externalId])` is global across the table, not per company,
   so a pair that would collide is already one row.
3. `SavedCompany` **can** collide — `@@unique([userId, companyId])`. Users who saved both
   rows: delete the loser's row and record `{ userId, createdAt }` in `moved`; everyone
   else is remapped.
4. `Revision`: `companyId` loser → survivor, and `entityId` loser → survivor where
   `entityType='company'` (a company revision anchors to itself —
   `admin.service.ts:79`).
5. `Citation`: `entityId` loser → survivor where `entityType='company'`. Collisions on
   `@@unique([sourceId, entityType, entityId, field])` are possible when both rows cite
   the same source for the same field — delete the loser's, recording it in `moved`.
6. `EntityIdentifier`: move the ones the survivor lacks; for the ones it already holds
   (the reason the pair was proposed), delete and record `{scheme, value, source}`.
7. `Company.mergedIntoId = survivor` on the loser. Nothing is deleted.
8. Write one `Revision` on the survivor: `action: 'MERGE'`, `field: ''`,
   `before: { slug, name } of the loser`, `after: { slug, name } of the survivor`,
   `actor: 'ADMIN'`.
9. Write the `MergeRecord`; flip the `MergeCandidate` to `MERGED`.

**Investor merge** — same shape over `InvestorHolding.investorId`,
`RoundInvestor.investorId`, `Fund.managerId`, `Citation` where `entityType='investor'`,
and `EntityIdentifier`. `InvestorHolding` rows that become duplicates for the same
(company, firm) pair are **left alone**: no unique constraint is violated, duplicates from
two sources are already possible today, and collapsing them would make the merge
irreversible.

`unmerge(mergeRecordId, adminUserId)` replays `moved` backwards inside one transaction:
move the listed child ids back to the loser, recreate the deleted `SavedCompany`,
`Citation` and `EntityIdentifier` rows from their recorded content, clear `mergedIntoId`,
write an `UNMERGE` revision, stamp `unmergedAt`, and set the candidate back to `PENDING`.
It refuses when the survivor has itself since been merged away — the state it would
restore no longer exists.

`listCandidates(status)` builds `MergeQueueResponse`, loading both sides plus their
identifier lists and child `_count`s in one pass.

`reject(candidateId, adminUserId)` sets `REJECTED` so no detector re-proposes the pair.

#### 2. Controller
**File**: `apps/api/src/admin/admin.controller.ts` — under the existing
`@UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN')`:

- `GET  /admin/merges?status=PENDING`
- `POST /admin/merges/:id/merge` — body `{ survivorId }`
- `POST /admin/merges/:id/reject`
- `POST /admin/merges/manual` — body `{ entityType, leftId, rightId }`, so an admin who
  spots a duplicate the detector missed can queue it
- `POST /admin/merges/records/:id/unmerge`

DTOs in `apps/api/src/admin/dto/` with `class-validator`, `@IsIn([...IDENTIFIABLE_TYPES])`
for `entityType` — the convention the other DTOs use for controlled vocabularies.

**File**: `apps/api/src/admin/admin.module.ts` — provide `MergeService`.

#### 3. Timeline rendering
**File**: `apps/web/app/companies/[slug]/history/page.tsx` — the `Entry` component
currently renders anything that is not `CREATE` as "— <field> changed" with a before/after
row (`:151,161`). Add an explicit `MERGE` / `UNMERGE` branch: "merged in <name>" /
"split back out <name>", with no field diff.

#### 4. Tests
**File**: `apps/api/src/admin/merge/merge.service.spec.ts` (new) — every child table is
remapped; `SavedCompany` collision deletes and records; `Citation` collision deletes and
records; the loser is tombstoned, not deleted; merging an already-merged row is refused;
`unmerge` restores every table to its pre-merge state (a round-trip assertion over a
fixture); unmerge is refused when the survivor is itself tombstoned; `reject` blocks
re-proposal.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `yarn workspace api test`
- [x] `make test`
- [x] `make lint`
- [x] `curl -s -X POST localhost:3000/admin/merges/manual -H 'authorization: Bearer <admin>' -d '{...}'` returns a candidate
- [x] Merge then unmerge on a scratch pair leaves the row counts of every child table unchanged

#### Manual Verification:
- [ ] After merging one of the 14 CIK pairs, the survivor's profile shows both rows' rounds/people
- [ ] The survivor's `/history` shows a "merged in …" entry that reads correctly
- [ ] Unmerging restores both profiles to what they showed before
- [ ] Merging a pair and re-running `make ingest DAYS=7 SOURCE=SEC_EDGAR` does **not** recreate the loser

**Implementation Note**: pause here for manual confirmation before Phase 8.

---

## Phase 8: Tombstone read paths and permanent redirects

### Overview
Make the merged-away row invisible to the public surface and turn its slug into a 308.

### Changes Required:

#### 1. Shared filters
**File**: `apps/api/src/prisma/public-filters.ts` (new)

```ts
/** What the public may see: approved, and not merged away. Every public read
 *  uses these — the tombstone filter is one edit here, not fourteen by hand. */
export const PUBLIC_COMPANY = {
  moderationStatus: 'APPROVED', mergedIntoId: null,
} satisfies Prisma.CompanyWhereInput;

export const PUBLIC_INVESTOR = {
  moderationStatus: 'APPROVED', mergedIntoId: null,
} satisfies Prisma.InvestorWhereInput;
```

Applied at every site the grep found: `companies.service.ts:83,119,136,253`,
`investors.service.ts:32,55,88,131`, `users.service.ts:47,76`. `market.service.ts`'s raw
SQL (`:58,73-74,103,108,114`) gains `AND c."mergedIntoId" IS NULL`. `funds.service.ts`
needs no change — an investor merge moves `Fund.managerId` to the survivor, so no fund is
left pointing at a tombstone.

#### 2. Redirect resolution
**File**: `apps/api/src/companies/companies.service.ts`, `investors.service.ts`

When the public lookup misses, a second lookup asks whether the slug belongs to a
tombstone and, if so, follows `mergedIntoId` to a live row — capped at 5 hops, because a
survivor can itself be merged later and a cycle must not hang the request. Then:

```ts
// 301 with the survivor's slug in the BODY and deliberately no Location header:
// with one, the web app's fetch would follow it server-side and silently render
// the survivor under the old URL, which is the opposite of what a permanent
// redirect is for. The browser has to see the move.
throw new HttpException({ message, redirectTo: survivor.slug }, HttpStatus.MOVED_PERMANENTLY);
```

`listSlugs` on both services already filters through `PUBLIC_*`, so the sitemap drops
tombstones automatically.

#### 3. Web
**File**: `apps/web/lib/api.ts` — `ApiError` gains `body: unknown`, parsed from the
response on a non-ok status (guarded: a non-JSON error body must not throw).

**File**: `apps/web/lib/data.ts` — `getCompanyDetail` and `getInvestor` call
`permanentRedirect('/companies/' + redirectTo)` on a 301. Doing it **inside** these two
functions means all 8 + 2 call sites are unchanged. Two of them wrap the call in
`.catch()` — `opengraph-image.tsx:17` and `contribute/actions.ts:107` — which swallows
Next's redirect signal; both degrade to their existing fallback, which is correct for an
OG image and for a POST against a slug that should not be reachable. Document it at both
sites.

`getCompanyHistory` gets the same treatment so `/companies/<old>/history` also redirects.

#### 4. Ingest follows the tombstone
**File**: `apps/jobs/src/ingest/ingest.service.ts` — `loadMatchIndex` and
`loadInvestorIndex` resolve `mergedIntoId` when building `byKey`, `byDomain`, `byName` and
`byIdentifier`, so a re-ingest of the loser's `(externalSource, externalId)` **enriches the
survivor**. This is the half of the tombstone design that keeps merges from being undone
by the next cron run; it is why the row is kept rather than deleted.

#### 5. Tests
**Files**: `companies.service.spec.ts`, `investors.service.spec.ts` — a tombstoned row is
absent from the list, absent from `listSlugs`, and its slug raises a 301 carrying the
survivor's slug; a 5-deep merge chain resolves to the final survivor; a cycle terminates.
`ingest.service.spec.ts` — a record keyed to a merged-away row updates the survivor.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `make test`
- [x] `make lint`
- [x] `curl -s -o /dev/null -w '%{http_code}' localhost:3000/companies/<losing-slug>` → `301`
- [x] `curl -s localhost:3000/companies/<losing-slug> | jq -r .redirectTo` → the survivor's slug
- [x] `curl -s localhost:3000/companies/sitemap | grep -c '<losing-slug>'` → `0`

#### Manual Verification:
- [ ] Visiting `/companies/<losing-slug>` in a browser lands on the survivor with the **URL changed** and a 308 in the network tab
- [ ] `/companies/<losing-slug>/history` redirects the same way
- [ ] The merged-away row is gone from `/companies`, from search, and from the market tape counts
- [ ] `make ingest DAYS=7 SOURCE=SEC_EDGAR` after a merge still creates no duplicate

**Implementation Note**: pause here for manual confirmation before Phase 9.

---

## Phase 9: Admin merge queue UI

### Overview
The screen an admin actually uses. Built in Tailwind + `components/ui` primitives per
CLAUDE.md ("don't add CSS Module files for new UI"), inside the existing
`app/admin/layout.tsx` shell — `admin.module.css` is legacy pending redesign and gains
nothing here.

### Changes Required:

**File**: `apps/web/lib/admin.ts` — `getMergeQueue`, `mergeCandidates`, `rejectCandidate`,
`unmergeRecord`, following the existing `getSubmissions`/`moderateSubmission` shape
(bearer token from `getToken()`, `cache: 'no-store'`).

**File**: `apps/web/app/admin/merges/actions.ts` (new) — server actions wrapping those,
each ending in `revalidatePath('/admin/merges')`, mirroring `app/admin/actions.ts`.

**File**: `apps/web/app/admin/merges/page.tsx` (new) — `requireAdmin()`, then:
- signal chips (`identifier` / `domain` / `name`) with counts, and status tabs
  (`PENDING` / `MERGED` / `REJECTED`), matching the existing queue's URL-driven
  `?status=&type=` pattern
- one card per candidate: the two sides in a two-column grid, each showing name, slug,
  domain, HQ, provenance key, created date, identifier list and child counts, with
  differing fields marked; the shared `evidence` shown once above, in mono
- three actions per card: **Merge into left**, **Merge into right**, **Not a duplicate**
- a `MERGED` tab row carries **Unmerge**

**File**: `apps/web/app/admin/layout.tsx` — a nav link to `/admin/merges` with the pending
count.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `make lint`
- [x] `make test`

#### Manual Verification:
- [ ] `/admin/merges` lists the identifier candidates first and the counts match the database
- [ ] Merging from the UI moves children and the survivor's profile is correct
- [ ] "Not a duplicate" removes the pair, and `make merge-candidates` does not bring it back
- [ ] Unmerge from the `MERGED` tab restores both profiles
- [ ] The page is strictly monochrome — no accent, no red except validation — and the identifier values are mono
- [ ] It is usable at a narrow width: the two-column diff stacks rather than scrolling the page sideways

---

## Testing Strategy

### Unit tests
- `packages/api` — normalizers and `identifierUrl`, per scheme, including the LEI checksum
  and every rejection.
- `apps/jobs` — `writeIdentifier` outcomes (written/unchanged/skipped/conflict) and
  candidate recording; the detector's pure grouping (pair generation, the group-size
  threshold, tombstone exclusion, rejected-pair suppression); ingest match precedence.
- `apps/api` — `MergeService` per-table remapping, both unique-collision cases, the
  tombstone, the merge/unmerge round trip, and the refusals.

### Integration
- Merge → re-ingest the same window → assert no duplicate is recreated. This is the whole
  point of the tombstone and the only test that proves it.
- Merge → unmerge → assert every child table's `groupBy(companyId)` counts match the
  pre-merge snapshot exactly.

### Manual testing steps
1. `make backfill-identifiers`, then check the per-scheme counts against the coverage
   table in this plan.
2. `make merge-candidates`, then hand-check ten candidates — five `identifier`, five
   `name`. If more than one `name` candidate is wrong, raise the group threshold before
   Phase 9 ships.
3. Merge one known CIK pair through `/admin/merges`. Confirm the survivor's profile,
   funding ladder and citations; confirm the old slug 308s; confirm `/history` shows the
   merge.
4. `make ingest DAYS=7 LIMIT=200 SOURCE=SEC_EDGAR` and confirm the loser is not recreated.
5. Unmerge it and confirm both profiles are back.

## Performance Considerations

- The identifier match index adds one `findMany` per ingest run over `EntityIdentifier`
  (~60k rows after the backfill) — the same order as the existing `Company` index load,
  which reads 35,860 rows. No per-record query is added.
- The name detector holds `{id, name}` for 43k rows, a few MB, for one CLI invocation.
- `getCompanyDetail` and `investors.findOne` each gain one indexed query on
  `@@index([entityType, entityId])`. List endpoints are untouched, so no page-sized fan-out.
- The redirect lookup is a **second** query only on the miss path, which is already the
  404 path.
- `@@unique([scheme, value, entityType])` gives the writer a single-index upsert; the
  conflict path costs one extra read to find the current holder.

## Migration Notes

- One migration, `add_entity_identifier_and_merge`, all additive: three new tables and two
  nullable columns. No existing row changes and no backfill is required for it to apply,
  so `prisma migrate deploy` on boot is safe on prod.
- `EntityIdentifier` is populated by an explicitly-run backfill, not by the migration —
  the same split `backfill-citations` uses, so a deploy never blocks on a data pass.
- Rollback: the migration is additive, so reverting the code leaves three unused tables and
  two unread columns. Nothing on the public surface depends on them until Phase 5.
- Ordering in `ingest-all` becomes: managers → funds → Form D → Wikidata → Form C → SBIR →
  S-1 → sectors → **identifiers** → **merge candidates** → citations. Identifiers must
  precede merge detection (it reads them) and both must precede citations (unchanged).
- No seed phase is added. Identifiers are derived, not seeded, and seed phases are
  immutable.

## References

- Original ticket: `thoughts/shared/tickets/2026-08-16-identifier-crosswalk-and-merge.md`
- Prior art for a polymorphic entity table + backfill CLI:
  `thoughts/shared/plans/2026-08-16-field-level-citations-and-revision-history.md`
- Prior art for a new first-class entity + ingest matching:
  `thoughts/shared/plans/2026-08-02-investor-entity-and-adv-ingestion.md`,
  `thoughts/shared/plans/2026-08-30-fund-entity.md`
- Match-and-enrich as it stands: `apps/jobs/src/ingest/ingest.service.ts:686-760`
- Domain-as-match-key rationale: `apps/jobs/src/util/domain.ts:1-13`
- Moderation transaction pattern to follow: `apps/api/src/admin/admin.service.ts:236-320`
- Rebuild runbook to update: `docs/DATA_REBUILD.md`
