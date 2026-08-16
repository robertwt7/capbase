# Field-Level Citations + Public Revision History Implementation Plan

## Overview

Make every published fact traceable to a primary document, and every change to a published
fact visible on a public timeline. Two features sharing one provenance schema: a `Source` /
`Citation` pair that answers *where did this come from*, and a `Revision` log that answers
*what changed and who changed it*.

## Current State Analysis

Provenance exists in the database and dies there. `externalSource` / `externalId` sit on
`Company`, `FundingRound`, `Person`, `InvestorHolding`, `AcquisitionDeal`, `ExitEvent` and
`Investor` (`schema.prisma`), are used as idempotency keys by the ingest jobs, and are never
read by the API, never mapped into a `@repo/api` type, and never rendered. There is no URL, no
retrieval timestamp, and no way to attach a source to one *field* rather than a whole row.

Change tracking is worse than absent — it is actively lossy:

- `AdminService.applyProposal` (`apps/api/src/admin/admin.service.ts:212-223`) loads the
  proposal, writes `companyDataFromChanges` onto the `Company` row, and flips the proposal to
  APPROVED. **The pre-change values are never persisted.** `pickCurrent`
  (`admin.service.ts:29-38`) computes "current" at *list* time for the reviewer's diff, not at
  apply time.
- `IngestService.enrich` (`apps/jobs/src/ingest/ingest.service.ts`) fills blank fields on
  matched companies — `domain`, `websiteUrl`, `linkedinUrl`, `primarySector`, `founded`,
  `headcount`, `oneLiner`, `description` — with no record whatsoever. This is the largest
  untracked write path in the system.
- Child-entity contributions are new rows whose only trace is a `moderationStatus` flip
  (`admin.service.ts:140-191`).

### Key Discoveries

- **Source URLs are derivable from data already stored — no re-fetching needed.**
  `EdgarClient` builds `https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/primary_doc.xml`
  from exactly the two values we persist (`edgar.client.ts:11,64-67`). Wikidata's
  `companyExternalId` *is* the QID, so `https://www.wikidata.org/wiki/{QID}` is a direct
  construction. This makes a backfill of the whole existing corpus a pure local operation.
- **Child rows don't carry the CIK/QID — only the parent company does.** Round external ids are
  bare accessions; person ids are `${cik}:person:${slug}`; Wikidata investor ids are
  `${qid}:investor:${invQid}`. The backfill must **join to the parent company** for the CIK/QID
  rather than parsing composite ids, which is both simpler and robust to the id formats
  changing.
- **Blocker: the public domain types expose no row identity.** `FundingRound`, `Person`,
  `InvestorHolding`, `AcquisitionDeal`, `ExitEvent` and `DiversitySignal`
  (`packages/api/src/domain/company.ts:107-161`) have no `id`, and the mappers
  (`company.mapper.ts:45-109`) don't emit one. Nothing in the UI can anchor a citation to a
  specific round until this changes. This is a required precursor, not a nice-to-have.
- **`moderate()` doesn't know who the admin is.** `AdminController.moderate`
  (`admin.controller.ts:47-59`) passes only type/id/status; `AdminService.moderate`
  (`admin.service.ts:140`) has no actor parameter. A `@CurrentUser()` decorator already exists
  (`apps/api/src/auth/decorators/current-user.decorator.ts`) and must be threaded through.
- **A nullable `field` breaks the obvious unique constraint.** Postgres treats NULLs as
  distinct, so `@@unique([sourceId, entityType, entityId, field])` would permit unlimited
  duplicate whole-row citations. Prisma's schema DSL does not expose `NULLS NOT DISTINCT`.
  `field` is therefore **non-nullable with `""` as the whole-row sentinel**.
- **`BigInt` cannot be JSON-serialized.** `totalRaisedUsd` and `lastValuationUsd` are `BigInt`;
  `JSON.stringify` throws on them. Every value entering a `Revision.before`/`after` column must
  pass through the same `Number()` conversion the mappers already use
  (`company.mapper.ts:31,126`).
- **Prisma distinguishes JSON null from SQL NULL.** Storing a genuine `null` value (a field
  cleared to null) requires `Prisma.JsonNull`, not bare `null` — bare `null` means "SQL NULL",
  i.e. "no value recorded", which is a different fact.
- `backfill-sectors.ts` (`apps/jobs/src/backfill-sectors.ts`) is the established one-off CLI
  pattern — `NestFactory.createApplicationContext`, keyset pagination by `id`, `make`
  target plus a `-prod` variant (`Makefile:151-158`). The citation backfill follows it exactly.

### Decisions taken (confirmed with the user)

1. **All mutation paths are recorded** — approved proposals, approved child contributions, and
   ingest enrichment.
2. **Citations are optional but prompted.** Every contribution form carries a source-URL field;
   uncited facts render an explicit "uncited" marker rather than looking identical to sourced ones.
3. **The history page is public and complete**, accepting that it reveals data past the
   `PREVIEW_LIMIT` contribution gate. Appropriate for an open-data project; it does slightly
   weaken the contribution incentive.
4. **Revisions are written on APPROVED transitions only**, never at submission. The timeline is a
   record of what was actually published; pending contributions stay private until moderated.

## Desired End State

- A company profile shows a citation marker next to every sourced fact, linking to the primary
  document; unsourced facts are visibly marked as such.
- `/companies/[slug]/history` renders a public, paginated timeline of every change to that
  company and its child rows, attributing each to a contributor, an admin, or a named ingest source.
- Existing SEC and Wikidata rows carry real citations from day one, without any network fetch.
- Contributors can attach a source URL to any contribution or edit proposal.

Verify by: opening a Form D-derived company and following its round citation to the SEC filing;
submitting a cited proposal, approving it, and seeing both the before/after entry on the history
page and the new field citation on the profile.

## What We're NOT Doing

- **No bulk data export / `/data` page / licence work.** Explicitly deferred by the user.
- **No confidence or quality scoring** per fact or per source.
- **No citation editing or removal UI.** Citations are created by contribution and backfill only;
  correcting a bad one is a database operation for now.
- **No revision *reverting*.** The timeline is read-only; rolling a change back means submitting a
  new proposal.
- **No history for investor profiles.** `Revision` is anchored to a company. Investor-side history
  is a follow-up.
- **No backfill of history.** It cannot be reconstructed — the old values were never stored.
  History starts empty on the day Phase 2 ships.
- **No change to the contribution gate** (`PREVIEW_LIMIT`, `CONTRIBUTION_WINDOW_DAYS`).

## Implementation Approach

Five phases, ordered so that the irreversible part happens first. Phase 2 (recording revisions)
ships before any read surface deliberately: history cannot be backfilled, so every day without
capture is permanently lost data. Phase 2 has no user-visible output — that is the intended
trade.

Citations and revisions share the `Source` table but are otherwise independent, so Phase 3 (the
citation backfill) and Phase 2 can be worked in either order if that suits.

---

## Phase 1: Provenance schema + shared types

### Overview

Add three models and their `@repo/api` counterparts. No behavior change; nothing reads or writes
these tables yet.

### Changes Required:

#### 1. Prisma models

**File**: `packages/db/prisma/schema.prisma`
**Changes**: Three new models, plus back-relations on `Company` and `User`.

```prisma
/// A primary document a fact came from. Deduplicated by URL, so many citations
/// share one row (every round from one Form D cites the same filing).
model Source {
  id         String  @id @default(cuid())
  url        String  @unique
  sourceType String  // one of SOURCE_TYPES
  title      String?
  publisher  String? // 'SEC', 'Wikidata', …
  /// Source-native reference: SEC accession, Wikidata QID, CRD number.
  reference  String?
  /// When the content behind `url` was last read. Backfilled rows use the
  /// cited row's updatedAt as the best available proxy.
  retrievedAt DateTime
  createdAt   DateTime @default(now())

  citations Citation[]

  @@index([sourceType])
}

/// Binds a Source to a specific fact. `field` is '' when the whole row is
/// attested, or a column name for a field-level citation. Non-nullable
/// because Postgres treats NULLs as distinct, which would defeat @@unique.
model Citation {
  id         String @id @default(cuid())
  sourceId   String
  source     Source @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  /// One of CITABLE_TYPES. Polymorphic by design: a typed FK per entity would
  /// mean seven nullable columns and seven joins on every profile read.
  entityType String
  entityId   String
  field      String @default("")
  note       String?

  submittedById String?
  submittedBy   User?    @relation(fields: [submittedById], references: [id], onDelete: SetNull)
  createdAt     DateTime @default(now())

  @@unique([sourceId, entityType, entityId, field])
  @@index([entityType, entityId])
}

/// One recorded change to published data. Anchored to a company so the profile
/// renders a single timeline across the company row and all its children.
model Revision {
  id        String  @id @default(cuid())
  companyId String
  company   Company @relation(fields: [companyId], references: [id], onDelete: Cascade)

  entityType String
  entityId   String
  /// Column that changed; '' for whole-row CREATE events.
  field      String @default("")
  /// JSON-encoded values. BigInt columns are converted with Number() first.
  before     Json?
  after      Json?

  action String // 'CREATE' | 'UPDATE'
  actor  String // 'USER' | 'ADMIN' | 'INGEST'
  actorUserId String?
  actorUser   User?   @relation(fields: [actorUserId], references: [id], onDelete: SetNull)
  /// Ingest source name when actor = 'INGEST' (SEC_EDGAR, WIKIDATA, SEC_ADV).
  actorSource String?
  /// The proposal that produced this entry, when applicable.
  proposalId  String?

  createdAt DateTime @default(now())

  @@index([companyId, createdAt])
  @@index([entityType, entityId])
}
```

Add to `model Company`: `revisions Revision[]`.
Add to `model User`: `citations Citation[]` and `revisions Revision[]`.

Add to `model ChangeProposal` (used in Phase 4, declared now so there is one migration):

```prisma
  /// Optional source URL the contributor attached; materialised into per-field
  /// Citations when the proposal is approved.
  sourceUrl String?
```

#### 2. Shared domain types

**File**: `packages/api/src/domain/provenance.ts` (new)

```ts
import type { ReviewableType } from './moderation';

export type SourceType = 'SEC filing' | 'Wikidata' | 'Company website' | 'Press' | 'Other';
export const SOURCE_TYPES: readonly SourceType[] = [
  'SEC filing', 'Wikidata', 'Company website', 'Press', 'Other',
];

/** Everything citable is reviewable, except a proposal (which is itself a change). */
export type CitableType = Exclude<ReviewableType, 'proposal'>;
export const CITABLE_TYPES: readonly CitableType[] = [
  'company', 'round', 'person', 'investor', 'acquisition', 'exit', 'diversity',
];

export interface SourceRef {
  url: string;
  sourceType: SourceType;
  title: string | null;
  publisher: string | null;
  reference: string | null;
  retrievedAt: string; // ISO
}

export interface Citation {
  id: string;
  entityType: CitableType;
  entityId: string;
  /** '' means the whole row is attested by this source. */
  field: string;
  note: string | null;
  source: SourceRef;
}

export type RevisionAction = 'CREATE' | 'UPDATE';
export type RevisionActor = 'USER' | 'ADMIN' | 'INGEST';

export interface Revision {
  id: string;
  entityType: CitableType;
  entityId: string;
  /** Human-readable subject, e.g. "Series B round" — resolved server-side. */
  entityLabel: string;
  field: string;
  before: unknown;
  after: unknown;
  action: RevisionAction;
  actor: RevisionActor;
  /** Contributor/admin display name, or the ingest source name. */
  actorName: string | null;
  createdAt: string;
}

export interface CompanyHistoryResponse {
  total: number;
  page: number;
  pageSize: number;
  items: Revision[];
}
```

Export from `packages/api/src/entry.ts`.

#### 3. Migration

```bash
make db-migrate   # name: add_provenance
```

### Success Criteria:

#### Automated Verification:
- [ ] Migration applies cleanly: `make db-migrate`
- [ ] A fresh prod-style rebuild works: `make db-verify-fresh`
- [ ] Prisma client regenerates: `make db-generate`
- [ ] Build passes across workspaces: `yarn build`
- [ ] Lint passes at zero warnings: `yarn lint`
- [ ] Unit tests still pass: `make test`

#### Manual Verification:
- [ ] `\d citation` in psql shows the 4-column unique index with `field NOT NULL`
- [ ] Existing pages render unchanged (nothing reads the new tables yet)

---

## Phase 2: Record revisions on every mutation path

### Overview

Start capturing history. Three write paths: proposal application, child-entity approval, and
ingest enrichment. No read surface — this phase is verified by inspecting the table.

### Changes Required:

#### 1. A revision-writing helper

**File**: `apps/api/src/provenance/revision.util.ts` (new)

`toJsonValue(v: unknown)` — converts `BigInt` → `Number`, `Date` → ISO date string, and returns
`Prisma.JsonNull` for genuine nulls so a cleared field is distinguishable from an unrecorded one.

#### 2. Capture before-state when a proposal is applied

**File**: `apps/api/src/admin/admin.service.ts`
**Changes**: `applyProposal` (`:212-223`) takes the acting admin's id, reads the company **inside
the transaction**, and writes one `Revision` per changed field.

```ts
private async applyProposal(id: string, adminUserId: string) {
  await this.prisma.$transaction(async (tx) => {
    const proposal = await tx.changeProposal.findUniqueOrThrow({
      where: { id },
      include: { company: true },
    });
    const changes = proposal.changes as CompanyEditFields;
    // Captured inside the transaction, before the update — this is the whole point.
    const before = pickCurrent(proposal.company, changes);

    await tx.company.update({
      where: { id: proposal.companyId },
      data: companyDataFromChanges(changes),
    });
    await tx.changeProposal.update({ where: { id }, data: { moderationStatus: 'APPROVED' } });

    await tx.revision.createMany({
      data: (Object.keys(changes) as (keyof CompanyEditFields)[]).map((field) => ({
        companyId: proposal.companyId,
        entityType: 'company',
        entityId: proposal.companyId,
        field: String(field),
        before: toJsonValue(before[field]),
        after: toJsonValue(changes[field]),
        action: 'UPDATE',
        actor: 'ADMIN',
        actorUserId: adminUserId,
        proposalId: proposal.id,
      })),
    });
  });
}
```

Re-approving an already-approved proposal re-applies the same values and writes a second, no-op
revision pair. Acceptable — it is a faithful record of the action taken.

#### 3. Record child-entity approvals

**File**: `apps/api/src/admin/admin.service.ts`
**Changes**: `moderate` (`:140-191`) gains an `adminUserId` parameter. Each `APPROVED` branch
selects `companyId` from the updated row and writes one `CREATE` revision with `field: ''` and
`after` set to the mapped domain object. `REJECTED` writes nothing — the row never became public.

The `company` case anchors to its own id (`entityId === companyId`). `approveInvestorHolding`
(`:193-210`) writes its revision inside the existing transaction.

#### 4. Thread the acting admin through the controller

**File**: `apps/api/src/admin/admin.controller.ts`
**Changes**: `moderate` (`:47-59`) adds `@CurrentUser() user: { id: string }` and passes `user.id`.

#### 5. Record ingest enrichment

**File**: `apps/jobs/src/ingest/ingest.service.ts`
**Changes**: `enrich` already computes a `data` object of exactly the fields it is about to
change and already holds the pre-update `row`. Write one revision per key before the update, in a
transaction with it:

```ts
if (Object.keys(data).length > 0) {
  await this.prisma.$transaction([
    this.prisma.company.update({ where: { id: companyId }, data }),
    this.prisma.revision.createMany({
      data: Object.keys(data).map((field) => ({
        companyId,
        entityType: 'company',
        entityId: companyId,
        field,
        before: toJsonValue((row as Record<string, unknown>)[field]),
        after: toJsonValue(data[field]),
        action: 'UPDATE',
        actor: 'INGEST',
        actorSource: r.source,
      })),
    }),
  ]);
}
```

`upsertCompany`'s own-key update branch (name/hq/industry/stage/totalRaisedUsd) also mutates
published data and gets the same treatment, comparing against the indexed row first so unchanged
values don't produce noise revisions.

**Gate it behind an env flag.** `INGEST_RECORD_REVISIONS` (default `true`). A from-scratch rebuild
via `make ingest-all` creates the entire corpus, and a "history" of that creation is noise, not
signal — `docs/DATA_REBUILD.md` should document setting it to `false` for a full rebuild.

### Success Criteria:

#### Automated Verification:
- [ ] Unit tests pass: `make test`
- [ ] New `admin.service.spec.ts` cases: approving a proposal writes one revision per changed
      field with the correct `before`; rejecting writes none
- [ ] New `ingest.service.spec.ts` case: enrichment writes a revision per filled field, and
      writes none when `INGEST_RECORD_REVISIONS=false`
- [ ] Lint passes: `yarn lint`
- [ ] Build passes: `yarn build`

#### Manual Verification:
- [ ] Submit an edit proposal, approve it in `/admin`, then confirm in psql that `Revision` holds
      the correct before/after and the admin's user id
- [ ] Run `make ingest DAYS=2 LIMIT=50` against a database with existing companies and confirm
      enrichment revisions appear with `actor='INGEST'` and the right `actorSource`
- [ ] Confirm `BigInt` fields (`totalRaisedUsd`) round-trip as numbers, not serialization errors

**Implementation Note**: After this phase and its automated verification, pause for manual
confirmation before proceeding.

---

## Phase 3: Citation backfill + read APIs

### Overview

Mint citations for the entire existing corpus from stored provenance, expose row ids on the child
domain types, and serve both citations and history over the API.

### Changes Required:

#### 1. Expose row identity on child domain types

**File**: `packages/api/src/domain/company.ts`
**Changes**: Add `id: string` to `FundingRound` (`:112`), `Person` (`:122`), `InvestorHolding`
(`:131`), `AcquisitionDeal` (`:142`), `ExitEvent` (`:150`), `DiversitySignal` (`:157`).

**File**: `apps/api/src/companies/company.mapper.ts`
**Changes**: Emit `id: row.id` from `toFundingRound` (`:49`), `toPerson` (`:60`),
`toInvestorHolding` (`:77`), `toAcquisition` (`:89`), `toExit` (`:98`), `toDiversity` (`:107`).

`RoundInvestor` is deliberately excluded — it has no independent citable identity.

#### 2. Citation backfill CLI

**File**: `apps/jobs/src/backfill-citations.ts` (new), modeled on `backfill-sectors.ts`

Walks each provenance-bearing table in keyset-paginated batches, **joining child rows to their
parent company** for the CIK/QID, and upserts `Source` (by `url`) then `Citation` (by the 4-column
unique key). Idempotent — safe to re-run.

URL construction per source:

| Source | Entity | URL |
|---|---|---|
| `SEC_EDGAR` | company (externalId = CIK) | `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=D` |
| `SEC_EDGAR` | round (externalId = accession) | `https://www.sec.gov/Archives/edgar/data/{cik}/{accession-no-dashes}/primary_doc.xml` |
| `SEC_EDGAR` | person | same filing URL as the company's most recent round |
| `WIKIDATA` | any (parent externalId = QID) | `https://www.wikidata.org/wiki/{qid}` |
| `SEC_ADV` | investor (externalId = CRD) | `https://adviserinfo.sec.gov/firm/summary/{crd}` |

The SEC filing URL reuses the exact construction in `edgar.client.ts:64-67`; factor that into a
shared helper rather than duplicating the string.

**Verify the IAPD firm-summary path before shipping** — it is the one URL in this table not
already exercised by existing code. If it doesn't resolve, fall back to the ADV filing search page
keyed by CRD.

`retrievedAt` is set from the cited row's `updatedAt`. That is a proxy, not a measurement, and the
code comment should say so.

**File**: `Makefile`
**Changes**: `backfill-citations` and `backfill-citations-prod` targets mirroring `:151-158`.

#### 3. Citations on the company detail read

**File**: `apps/api/src/companies/companies.service.ts`
**Changes**: `getCompanyDetail` (`:124-159`) additionally loads citations for the company row and
every approved child row it is returning, in **one** query:

```ts
const ids = [row.id, ...row.rounds.map(r => r.id), ...];
const citations = await this.prisma.citation.findMany({
  where: { entityId: { in: ids } },
  include: { source: true },
});
```

Returned as a flat `citations: Citation[]` on `CompanyDetailResponse`; the client indexes by
`entityId` + `field`. Citations are fetched **after** preview truncation so a locked viewer
doesn't receive citations for rows they can't see.

**File**: `packages/api/src/domain/contributions.ts`
**Changes**: Add `citations: Citation[]` to `CompanyDetailResponse`.

#### 4. History endpoint

**File**: `apps/api/src/companies/companies.controller.ts`
**Changes**: `@Get(':slug/history')` — public, paginated, declared **before** the existing
`@Get(':slug')` param route (the file already documents this ordering requirement for
`sitemap`).

**File**: `apps/api/src/companies/companies.service.ts`
**Changes**: `getCompanyHistory(slug, page, pageSize)` — resolves the slug to an APPROVED company,
returns `Revision` rows ordered `createdAt desc`, joined to `actorUser` for the display name.
`entityLabel` is resolved per entity type in a follow-up batched query per type, so the timeline
can say "Series B round" instead of a cuid.

`actorName` is the user's `name` for USER/ADMIN, or `actorSource` for INGEST. **Never the email** —
this endpoint is public.

### Success Criteria:

#### Automated Verification:
- [ ] Build + lint pass: `yarn build && yarn lint`
- [ ] Unit tests pass: `make test`
- [ ] Mapper spec asserts `id` is emitted on all six child types
- [ ] `companies.service.spec.ts` covers: history excludes non-approved companies; citations are
      not returned for preview-truncated rows; `actorName` never contains an email
- [ ] Backfill is idempotent — running it twice produces the same `Citation` count
- [ ] `curl localhost:3000/companies/<slug>/history` returns 200 with a paginated body

#### Manual Verification:
- [ ] Run `make backfill-citations` on a database with real ingested data; spot-check that a SEC
      round's citation URL actually resolves to that filing on sec.gov
- [ ] Spot-check a Wikidata company's citation resolves to the right QID page
- [ ] Confirm the ADV firm-summary URL resolves for a known CRD
- [ ] Citation counts look sane against row counts (roughly one source per filing, many citations)

**Implementation Note**: Pause for manual confirmation after this phase — the backfill touches
every row in the database and its URLs must be spot-checked against live sources.

---

## Phase 4: Contributors can cite

### Overview

A source-URL field on every contribution path, optional but prompted.

### Changes Required:

#### 1. DTOs

**File**: `apps/api/src/companies/dto/contributions.dto.ts`
**Changes**: `sourceUrl?: string | null` with `@IsOptional() @IsUrl()` on each of the six
contribution DTOs.

**File**: `apps/api/src/companies/dto/create-company.dto.ts` — same.

**File**: `apps/api/src/companies/dto/create-proposal.dto.ts`
**Changes**: `sourceUrl` on `CreateChangeProposalDto` (**not** on `CompanyEditFieldsDto` — the
whitelist there is the editable-field set and must not grow).

**File**: `packages/api/src/domain/inputs.ts` and `domain/proposals.ts`
**Changes**: Matching optional `sourceUrl` on the corresponding `Create*Input` types.

#### 2. Service handling

**File**: `apps/api/src/companies/companies.service.ts`
**Changes**: A private `attachCitation(entityType, entityId, sourceUrl, userId)` that upserts the
`Source` (sourceType `'Other'`, `retrievedAt: now`) and creates a whole-row `Citation`
(`field: ''`). Called from each `add*` method (`:196-326`) and `createCompany` (`:161-194`).

Citations are created **at submission**, pointing at a still-PENDING row. This avoids adding a
`sourceUrl` column to seven tables. Phase 3's read path only ever loads citations for rows it is
already returning — all approved — so a citation on a rejected row is inert.

`proposeChange` (`:328-355`) instead stores `dto.sourceUrl` on the `ChangeProposal.sourceUrl`
column added in Phase 1. `applyProposal` then materialises **one citation per changed field**,
which is where field-level citation actually earns its name.

#### 3. Web forms

**File**: `apps/web/lib/validation/{company,round,person,investor,acquisition,exit,diversity,proposal}.ts`
**Changes**: `sourceUrl: z.string().url().or(z.literal(''))` in each `*FormSchema`, `''` in
`*FormDefaults`, mapped to `null` when empty by each `to*Input`.

**File**: `apps/web/app/companies/[slug]/contribute/forms.tsx` (the six contribution forms) and
`contribute/EditCompanyForm.tsx` (the proposal form)
**Changes**: A `<TextField name="sourceUrl">` labelled "Source URL" with helper text explaining
that cited facts are marked as verified. Last field in each form — optional fields go last.

**File**: `apps/web/app/companies/[slug]/contribute/actions.ts` and `[slug]/actions.ts`
**Changes**: The server actions re-run `schema.safeParse` and must pass `sourceUrl` through to the
`to*Input` mapper. Server stays authoritative — the client value is never trusted.

### Success Criteria:

#### Automated Verification:
- [ ] Build + lint pass: `yarn build && yarn lint`
- [ ] Unit tests pass: `make test`
- [ ] `proposals.service.spec.ts`: approving a proposal with a `sourceUrl` creates one citation
      per changed field, each with the right `field` value
- [ ] A contribution with a malformed `sourceUrl` is rejected with 400
- [ ] A contribution with no `sourceUrl` still succeeds (optional, not required)

#### Manual Verification:
- [ ] Submit a round with a source URL; approve it; the citation appears on the profile
- [ ] Submit an edit proposal with a source URL touching two fields; approve; both fields carry a
      citation to that one source
- [ ] Submitting with the field left blank works and produces an uncited row

---

## Phase 5: Web surface

### Overview

Render citations on the profile and build the public history page. Strictly monochrome — this is
new UI in the parchment-ledger system.

### Changes Required:

#### 1. Citation marker component

**File**: `apps/web/components/Citation.tsx` (new)

A superscript mono reference rendering as a small bracketed link (`text-graphite-5`,
`font-mono`, `text-[10px]`) with the publisher in its `title`. Its uncited sibling state is a
muted `—` with an accessible label. **No color** — per the design system, emphasis is weight and
size, and red is reserved for validation feedback only.

Takes `citations`, `entityId`, and optional `field`, and resolves the match itself so callers stay
terse.

#### 2. Profile integration

**File**: `apps/web/app/companies/[slug]/page.tsx`
**Changes**: Thread `citations` from the detail response into the sections. Markers on: the
funding ladder rows, investor cards, people rows, acquisitions, exits, and the company facts
(`hq`, `founded`, `headcount`, `totalRaisedUsd`, `lastValuationUsd`).

`FundingLadder` (`apps/web/components/FundingLadder.tsx`) needs a `citations` prop — it owns the
round row rendering.

A "Sources" link in the profile header pointing at the history page.

#### 3. History page

**File**: `apps/web/app/companies/[slug]/history/page.tsx` (new)

A ledger timeline: hairline-ruled rows, mono uppercase date and actor, before → after values with
the old value struck through in `text-graphite-5`. Reuses `formatUsd`/`formatDate` from
`lib/format.ts` — no inline formatting. Uses the existing `<Pagination>`
(`apps/web/components/ui/pagination.tsx`, exported from the `components/ui` barrel).

Empty state via `EmptyState`: history begins when the feature ships, so most companies will show
nothing for a while. The copy should say that plainly rather than implying nothing ever changed.

**File**: `apps/web/lib/data.ts`
**Changes**: `getCompanyHistory(slug, page)` following the existing getter pattern (60s ISR).

#### 4. Admin review queue shows the cited source

**File**: `apps/web/app/admin/page.tsx`
**Changes**: Render the submitted `sourceUrl` as a link on each queue item so a moderator can
check the source before approving. This is the single highest-value use of the whole feature and
costs almost nothing.

### Success Criteria:

#### Automated Verification:
- [ ] Build + lint pass: `yarn build && yarn lint`
- [ ] Unit tests pass: `make test`
- [ ] `/companies/[slug]/history` renders for a company with zero revisions without erroring

#### Manual Verification:
- [ ] Citation markers appear on a Form D company and link to the real filing
- [ ] Uncited facts show the uncited marker, and the two states are visually distinguishable
- [ ] History page reads correctly for a company with proposal, contribution, and ingest entries
- [ ] Page holds up on mobile — the before/after column is the layout risk
- [ ] Nothing introduces color; the page still reads as monochrome parchment
- [ ] Keyboard focus is visible on citation links
- [ ] A logged-out viewer sees the full history (the deliberate gate bypass)

---

## Testing Strategy

### Unit Tests:
- `toJsonValue`: BigInt → number, Date → ISO string, null → `Prisma.JsonNull`, arrays preserved
- `applyProposal`: before-state captured inside the transaction; one revision per changed field
- `moderate`: APPROVED writes a revision, REJECTED writes none, for every reviewable type
- `enrich`: revision per filled field; nothing written when the flag is off
- Citation URL builders: one case per source, including a composite child external id
- Mappers: `id` present on all six child types

### Integration Tests:
- Full round trip: contribute a cited round → approve → citation and revision both readable via
  the API and both attached to the right entity
- Backfill idempotency: run twice against a seeded database, assert stable `Source`/`Citation` counts
- Preview gating: a locked viewer receives no citations for truncated rows

### Manual Testing Steps:
1. `make db-reset && make db-seed`, then `make ingest DAYS=7 LIMIT=200`
2. `make backfill-citations`; open a Form D company and follow a round citation to sec.gov
3. Submit an edit proposal with a source URL as a normal user
4. Approve it in `/admin`, confirming the source link is visible in the queue first
5. Open `/companies/[slug]/history` and confirm the before/after entry, actor, and timestamp
6. Re-run `make ingest` and confirm enrichment entries appear attributed to the source
7. Check the history page logged out, and on a narrow viewport

## Performance Considerations

- **The detail read gains one query.** `getCompanyDetail` already issues one query with six
  includes; citations add a single `findMany` over a bounded id list. Indexed by
  `(entityType, entityId)`.
- **Ingest gets slower.** Every enriched company becomes a transaction of two statements instead
  of one. `INGEST_RECORD_REVISIONS=false` exists for full rebuilds, where the cost is worst and
  the value is lowest.
- **The backfill is a full table scan across six tables**, batched by keyset like
  `backfill-sectors.ts`. On the current corpus (~11k companies, ~5k rounds, ~6.7k holdings) it
  should be minutes, not hours, and it is re-runnable.
- **`Revision` grows monotonically** and is never pruned. At current change rates this is
  negligible; if it ever matters, the fix is partitioning by `createdAt`, not deletion — deleting
  audit history would defeat the feature.

## Migration Notes

- One migration in Phase 1 covers all three models plus `ChangeProposal.sourceUrl`, so there is a
  single schema change to deploy and roll back.
- `Citation.field` and `Revision.field` default to `""`, so no data backfill is needed for
  existing rows (there are none).
- **History is not backfillable.** Deploy Phase 2 as early as possible; every day it is not
  deployed is history permanently lost.
- The citation backfill is a manual post-deploy step (`make backfill-citations-prod`), not a boot
  migration — it is long-running and must not block the API container starting.
- Rollback: dropping the three tables loses all captured history. Take a backup
  (`make deploy-backup`) before deploying Phase 2 to production.

## References

- Ticket: `thoughts/shared/tickets/2026-08-16-citations-and-revision-history.md`
- Proposal source: the gap analysis artifact (proposal 02, "Citations on every fact")
- Prior art for the one-off CLI: `apps/jobs/src/backfill-sectors.ts`, `Makefile:151-158`
- Prior art for a polymorphic moderation surface: `apps/api/src/admin/admin.service.ts:57-138`
- Related tickets, sequenced after this work:
  `thoughts/shared/tickets/2026-08-16-identifier-crosswalk-and-merge.md`,
  `2026-08-16-form-c-s1-sbir-ingestion.md`, `2026-08-16-fund-entity.md`,
  `2026-08-16-people-first-class.md`, `2026-08-16-structured-geography.md`
