# People as a first-class entity — Implementation Plan

## Overview

Promote `Person` from a child row hanging off one company to a **top-level entity with a
slug**, deduplicated by identifier-then-exact-name, and join it to **both companies and
investor firms** through a `PersonRole` table carrying title, role kind and a date range.
Ship `/people` and `/people/[slug]`, and reuse the merge queue built by the identifier
crosswalk for every pair the automatic rule deliberately refuses to collapse.

## Current State Analysis

### Measured against the live local database (2026-09-06)

| `Person.externalSource` | rows | distinct companies |
|---|---|---|
| `SEC_FORM_C` | 19,615 | 8,840 |
| `SEC_EDGAR` | 16,022 | 5,137 |
| `SBIR` | 10,963 | 5,100 |
| `WIKIDATA` | 356 | 171 |
| contributed (null) | 5 | 1 |
| **total** | **46,961** | — |

Anchored to those rows: **46,394 `Citation`** rows with `entityType='person'`, and **0**
`Revision` rows — history on people has never been written, so nothing in this plan has to
preserve one.

### The ticket's stated dedup key does not exist

The ticket asks to deduplicate "on name plus LinkedIn URL (LinkedIn URL is the only
reliable key we have)". Measured:

```
select count(*) from "Person" where "linkedinUrl" is not null and "linkedinUrl" <> '';
 -> 2
```

**Two rows out of 46,961.** Both are demo-seed rows from phase `002`. No ingest source
publishes a LinkedIn URL for a person: Form D's `relatedPersonsList` has name, address and
relationship; Form C's signature block has name and title; Wikidata's P112/P169 give a QID
and a label. The matching rule has to be rebuilt from something that is actually present.

### What *is* present: the Wikidata person QID

`wikidata.mapper.ts:266` mints `externalId` as `${companyQid}:person:${personQid}:${role}`
— so the person's own QID is **already stored on every Wikidata row** and is recoverable
with no network access, exactly the way `backfill-citations.ts` reconstructs every URL from
stored identifiers:

| | |
|---|---|
| Wikidata person rows | 356 |
| distinct person QIDs | 292 |
| well-formed `^Q[1-9][0-9]*$` | 356 / 356 |
| QIDs already spanning >1 company | **10** |

Those 10 are the ticket's serial-founder case, sitting in the database today and
unreachable because nothing indexes the QID.

### All 10,963 SBIR person rows are federal agency staff

Top names by distinct company count:

| name | companies |
|---|---|
| Rajesh Mehta | 299 |
| Ruth Shuman | 249 |
| Peter Atherton | 222 |
| Henry Ahn | 214 |
| Muralidharan Nair | 209 |
| Jesus Soriano | 194 |

These are NSF SBIR program directors, not company executives. The cause is in
`sbir.parser.ts:196-216`, whose comment claims the opposite of what the code does:

```ts
/**
 * Company contacts only. `PI Name` is present on nearly every award but names
 * the principal investigator — a role on the grant, not a role at the company —
 * so it is deliberately skipped.
 */
function peopleMap(key: string, row: SbirRow, year: number): Map<string, NormalizedPerson> {
  const name  = (row['Contact Name'] ?? '').replace(/\s+/g, ' ').trim();
  const title = (row['Contact Title'] ?? '').replace(/\s+/g, ' ').trim();
  if (!name || !title) return out;          // <- this guard selects FOR agency rows
```

Measured on a 3,940-row sample of the live bulk CSV: `Contact Name` is populated almost
exclusively for **DoD (2,008)** and **NASA (419)**, and **1,655 of its 2,491 populated rows
carry a blank title**. So the "both must be present" guard drops the genuine company
contacts and keeps the agency desk that processed the award. The column is not what the
comment believes it is.

### Removing SBIR is what makes name-based dedup viable

Distinct-company spread of a normalized full name, **excluding** SBIR:

| companies per name | name keys | rows |
|---|---|---|
| 1 | 31,533 | 31,803 |
| 2–3 | 1,467 | 3,166 |
| 4–8 | 136 | 666 |
| 9+ | **23** | **363** |

With SBIR included that 9+ bucket is 6,530 rows — a name-based rule would be indefensible.
Without it, the bucket is 23 keys, and every one of them is legitimately a single human:
`paul grossinger` 75 (Gaingels SPVs), `howard marks` 30 and `nicholas tommarello` 25
(Wefunder co-founders, one row per Reg CF offering), `greg womack` 16. The long tail is a
person who signs a lot of filings, which is exactly what we want to collapse.

### `PI Name` is a clean replacement

Same 3,940-row sample:

| | |
|---|---|
| rows with a `PI Name` | 3,940 / 3,940 |
| distinct PI names | 3,392 |
| PI names at exactly 1 firm | 3,373 |
| PI names at 2 firms | 19 |
| PI names at 3+ firms | **0** |
| rows carrying a `PI Title` | **70 / 3,940** |

No concentration whatsoever — the opposite of the contact column. The one consequence for
the code: with only 70 titles in 3,940 rows, the existing `if (!name || !title)` guard would
drop 98% of principal investigators, so the guard must relax to name-only and the role
becomes the constant `'Principal investigator'` — itself a structural fact (it is what the
column *is*), not a guess.

### Role vocabulary is closed per source, not globally

| source | role values | rows |
|---|---|---|
| `SEC_EDGAR` | `Executive Officer` 9,815 · `Director` 5,970 · `Promoter` 237 | 16,022 |
| `WIKIDATA` | `Founder` 274 · `CEO` 82 | 356 |
| `SEC_FORM_C` | free text (signature-block titles) | 19,615 |

Form D's `relationship` is a closed SEC enum and Wikidata's role comes from the property
identity (P112/P169). Those two are structured and can carry a controlled `kind`. Form C
is free prose and honestly cannot — the same stance `primarySector` already takes
("Form C has no industry field, so those rows are honestly unclassified"). Structured
coverage after the SBIR purge: **16,378 of 35,998** role edges.

### Same-company name variants

859 `(companyId, first+last)` groups contain more than one spelling of the full name —
middle initials, `ADAM LARSON` vs `Adam Larson`. Bounded, high-precision, and precisely the
shape the merge queue was built for.

## Desired End State

- A `Person` table with `slug`, `name`, `normalizedName`, `mergedIntoId` and `suppressedAt`,
  one row per human, minted by a no-network backfill and thereafter written by ingest.
- A `PersonRole` table — the renamed old `Person` — carrying `personId`, `companyId` **or**
  `investorId`, `role`, `kind`, `title`, `since`, `endYear`, keeping its original row ids so
  all 46,394 citations stay anchored with **zero citation migration**.
- Dedup is **identifier, then exact normalized full name**. A Wikidata person QID collapses
  rows globally; failing that, an exactly-equal normalized name does. Name *variants* never
  auto-merge — they become `MergeCandidate` rows.
- `/people` (URL-driven filters + pagination) and `/people/[slug]`; company and investor
  profiles link their people; sitemap carries person slugs.
- A person's slug survives a merge as a 301, and a suppression tombstone survives the next
  ingest run.

### Key Discoveries

- **`packages/db/prisma/schema.prisma:423-447`** — `Person` today: `companyId` required,
  no slug, no identity. `@@unique([externalSource, externalId])` is global across the
  table, so a rename preserves every uniqueness guarantee the ingest path relies on.
- **`packages/db/prisma/schema.prisma:401-405`** — the load-bearing precedent for a nullable
  FK, written verbatim on `InvestorHolding.investorId`: *"Nullable because seed phase 002
  shipped before this column existed and seed phases are immutable; every write path (ingest
  + contribution) populates it."* `PersonRole.personId` ships nullable for exactly this
  reason — `002-demo-companies.ts:286` creates people through a nested `people: { create: … }`
  with no person id, and a shipped phase can never be edited.
- **`packages/api/src/domain/provenance.ts:28`** — `CitableType = Exclude<ReviewableType,
  'proposal'> | 'fund'`, and `'investor'` in it already means `InvestorHolding`, not
  `Investor`. `backfill-citations.ts:410,446` emits `entityType: 'investor'` for **both**
  tables. So `entityType` is already an overloaded label whose real uniqueness lives in
  `entityId` — which is why `'person'` can keep meaning the role row while a separate
  `Person` entity exists beside it.
- **`apps/api/src/companies/companies.service.ts:248`** — `loadCitations` filters on
  `entityId: { in: ids }` with **no** `entityType` clause, so the citation read path is
  already indifferent to the label.
- **`apps/jobs/src/ingest/ingest.service.ts:546-556`** — the current person write is a bare
  `upsert` keyed on `(externalSource, externalId)` inside the company upsert. It has no
  match index and no notion of a person existing elsewhere.
- **`apps/jobs/src/ingest/ingest.service.ts:651-688`** (`resolveInvestor`) and `:689-800`
  (`upsertInvestorFirm`) — the exact template for resolving a child row to a first-class
  entity and for a `byKey → byIdentifier → byDomain → byName` match index.
- **`apps/jobs/src/ingest/identifier.writer.ts:66,125`** — `writeIdentifier` and
  `recordCandidate` are already generic over `IdentifiableType`. Widening that union is the
  whole of the "share the matching machinery" the ticket asks for; no new detector is needed
  for the identifier signal.
- **`apps/api/src/admin/merge/merge.service.ts:68`** — `COMPANY_CHILDREN` already contains
  `'person'`, so a company merge moves role rows today and keeps doing so after the rename.
- **`apps/api/src/admin/merge/merge.service.ts:433`** — `mergeInvestor` writes **no**
  `Revision`, because `Revision.companyId` is required and an investor has no single
  company. A person is in the same position; person merges follow that precedent.
- **`apps/api/src/prisma/public-filters.ts`** — `PUBLIC_COMPANY`/`PUBLIC_INVESTOR` centralise
  `moderationStatus: 'APPROVED', mergedIntoId: null`. `PUBLIC_PERSON` belongs here and adds
  a third condition, `suppressedAt: null`.
- **`apps/jobs/src/sources/wikidata/wikidata.queries.ts:108`** — `peopleQuery(qids)` already
  returns P112/P169 officers for any QID list. `investorFirmsQuery():90` fetches firms but
  asks for no people. 368 investor rows carry a well-formed QID, so the investor side of
  `PersonRole` is one extra call to a query that already exists.
- **`apps/api/src/investors/investors.service.ts`** — the whole shape of a paginated
  directory + detail + `listSlugs` service, to be mirrored for people.

## What We're NOT Doing

- **No LinkedIn-based matching.** The ticket names it as the primary key; it exists on 2 of
  46,961 rows. The field stays on `PersonRole` and renders, but it is not a match signal and
  no phase tries to populate it.
- **No fuzzy or phonetic name matching.** Nicknames, transliterations and initials-only
  spellings are not collapsed automatically. Exact normalized equality auto-merges; anything
  looser goes to the merge queue for a human. This is the same line the identifier plan drew
  — "the detector needs a key *looser* than the matcher's" — and it is why the 859 variant
  groups are candidates rather than merges.
- **No cross-company disambiguation of common names.** Two genuinely different people named
  `John Smith` at two companies **will** be collapsed into one person by the name rule. This
  is a deliberate, measured trade: post-purge, 31,533 of 33,159 name keys touch exactly one
  company, and the 23 keys at 9+ companies are all real single humans. Splitting a wrongly
  merged person is the merge queue's `unmerge`, which already exists.
- **No people on the contribution or moderation queue as a new type.** `ReviewableType`
  keeps `'person'` meaning the role row, so the existing "add a team member" form,
  `countsByType` and `moderate()` are untouched. A contributed role resolves to a person
  server-side, exactly as a contributed holding resolves to an investor firm today.
- **No person-level revision history.** `Revision.companyId` is required and a person spans
  many companies; there are 0 person revisions today. Making the timeline person-aware is
  its own ticket.
- **No people in the SBIR, Form C or S-1 identifier crosswalk beyond Wikidata.** `WIKIDATA`
  is the only scheme any source publishes for a human. `IdentifiableType` widens to admit
  `'person'`, but no other scheme is minted for one.
- **No merging of a person with a company or an investor.** Same rule the identifier plan
  set: cross-type merging is out of scope.
- **No deletion of `PersonRole.name`.** The denormalized name stays on the role row: it is
  the source's own spelling, it is what a citation attests, and an unmerge must be able to
  restore it.

## Implementation Approach

Seven phases. Phase 1 is independent and shippable alone — and it must go first, because
minting person slugs for 10,963 federal program officers is work we would then have to
undo. Phase 2 is the only migration. Phases 3–7 are pure code, each independently
verifiable.

The rename is the pivot of the whole plan. `ALTER TABLE "Person" RENAME TO "PersonRole"`
preserves every row id, so all 46,394 citations stay anchored, `COMPANY_CHILDREN` keeps
working, and no data is copied. A create-and-copy migration would mint new ids and force a
46,394-row citation remap for no benefit.

---

## Phase 1: Purge SBIR agency contacts, ingest principal investigators

### Overview
Delete the 10,963 rows that describe federal program officers rather than company people,
and replace the source's reading of `Contact Name` with `PI Name`. Independently shippable:
it improves the corpus whether or not the rest of this plan lands, and it is what makes the
name-based dedup rule in Phase 3 defensible.

### Changes Required:

#### 1. The parser
**File**: `apps/jobs/src/sources/sbir/sbir.parser.ts:196-216`

Replace `peopleMap` and its comment. The new comment must state the measurement, not an
intention:

```ts
/**
 * Principal investigators.
 *
 * `Contact Name` was read here until 2026-09-06 and was wrong: measured over the
 * live bulk file it is populated almost exclusively for DoD and NASA awards, and
 * names the agency desk that processed the grant, not anyone at the company. It
 * put 10,963 rows in the corpus led by NSF program directors at 299, 249 and 222
 * companies each.
 *
 * `PI Name` is on every award (3,940/3,940 sampled) and is firm-specific: of
 * 3,392 distinct PIs, 3,373 appear at exactly one firm, 19 at two, none at three.
 *
 * The role is the constant 'Principal investigator' rather than `PI Title`, which
 * is present on only 70 of 3,940 rows — requiring it, as the old guard did for
 * `Contact Title`, would drop 98% of them. The constant is structural: it is what
 * the column means, not a guess about the person.
 */
function peopleMap(key: string, row: SbirRow, year: number): Map<string, NormalizedPerson> {
  const out = new Map<string, NormalizedPerson>();
  const name = (row['PI Name'] ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return out;

  const title = (row['PI Title'] ?? '').replace(/\s+/g, ' ').trim();
  const externalId = `${key}:person:${kebab(name)}`;
  out.set(externalId, {
    externalId,
    name,
    role: 'Principal investigator',
    title: title || null,
    since: year || new Date().getUTCFullYear(),
  });
  return out;
}
```

`SbirRow` gains `'PI Name'` and `'PI Title'`; confirm both against the header row of the
live CSV before relying on the spelling.

#### 2. The purge CLI
**File**: `apps/jobs/src/purge-sbir-people.ts` (new)

Modelled on `backfill-sectors.ts` (`NestFactory.createApplicationContext`, batched, progress
log). One `$transaction`:

1. `Citation.deleteMany({ where: { entityType: 'person', entityId: { in: <batch> } } })` —
   measured 10,963, one per row.
2. `Person.deleteMany({ where: { externalSource: 'SBIR', id: { in: <batch> } } })`.

Orphaned `Source` rows are **left alone**: `Source` is deduplicated by URL and shared across
entities, and `backfill-citations` is idempotent, so deleting a source another row cites
would be a bug. Counts both deletions and prints them.

The script is **not** added to `ingest-all` — it is a one-shot correction, not a recurring
step. `docs/DATA_REBUILD.md` records that a from-scratch rebuild never needs it, because the
fixed parser never writes the rows.

#### 3. Make target
**File**: `Makefile` — `purge-sbir-people` / `purge-sbir-people-prod`, mirroring the
`backfill-citations` pair.

#### 4. Tests
**File**: `apps/jobs/src/sources/sbir/sbir.parser.spec.ts` — a row with a `PI Name` and no
`PI Title` yields a person with role `Principal investigator` and `title: null`; a row with
both yields the title too; a row with a `Contact Name` but no `PI Name` yields **nothing**
(the regression guard for the bug being fixed); two awards for the same firm and PI collapse
to one person.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `yarn workspace jobs test`
- [x] `make lint`
- [x] `make purge-sbir-people` reports 10,963 people and 10,963 citations deleted
- [x] Re-running `make purge-sbir-people` deletes 0 (idempotent)
- [x] A bounded live run writes PIs: `make ingest DAYS=1 LIMIT=50 SOURCE=SBIR`

#### Manual Verification:
- [ ] `select name, count(distinct "companyId") from "Person" where "externalSource"='SBIR' group by 1 order by 2 desc limit 10` shows no name above ~3 companies
- [ ] A spot-checked SBIR company profile lists its principal investigator, not an NSF program director
- [ ] `select count(*) from "Citation" c left join "Person" p on p.id=c."entityId" where c."entityType"='person' and p.id is null` returns 0 — no dangling citations

**Implementation Note**: pause here for manual confirmation before Phase 2.

---

## Phase 2: Vocabulary, schema, and the one migration

### Overview
Everything later phases write against: the `RoleKind` vocabulary and person domain types in
`@repo/api`, and one migration that renames `Person` to `PersonRole` and adds the new
`Person` entity beside it.

### Changes Required:

#### 1. Role vocabulary
**File**: `packages/api/src/domain/person.ts` (new)

```ts
/**
 * What sort of role this is, when the source says so *structurally*.
 *
 * Populated only from a closed publisher vocabulary: Form D's `relationship`
 * enum (Executive Officer / Director / Promoter) and Wikidata's property
 * identity (P112 founder, P169 CEO). Null for Form C, whose roles are free
 * prose in a signature block, and for contributions — the same stance
 * `primarySector` takes on Form C's missing industry field. Never inferred by
 * reading a title string.
 */
export type RoleKind = 'Founder' | 'CEO' | 'Executive officer' | 'Director' | 'Promoter';

export const ROLE_KINDS: readonly RoleKind[] = [
  'Founder', 'CEO', 'Executive officer', 'Director', 'Promoter',
];

/** A human, deduplicated across every company and firm they appear at. */
export interface PersonSummary {
  id: string;
  slug: string;
  name: string;
  roleCount: number;
  companyCount: number;
  /** The companies/firms to show on a directory card, newest role first. */
  roles: PersonRole[];
}

/** One role: this person, at this company or firm, in this capacity. */
export interface PersonRole {
  id: string;
  role: string;
  kind: RoleKind | null;
  title: string | null;
  since: number;
  endYear: number | null;
  prior: string | null;
  linkedinUrl: string | null;
  /** Exactly one of these two is set. */
  company: { slug: string; name: string; domain: string | null } | null;
  investor: { slug: string; name: string } | null;
}

export interface PersonDetailResponse extends PersonSummary {
  identifiers: EntityIdentifierRef[];
  citations: Citation[];
}

export interface PersonSlugEntry { slug: string; updatedAt: string; }
```

**File**: `packages/api/src/domain/pagination.ts` — mirroring `InvestorSort:32-40`:

```ts
/** Roles-first by default: a person at six companies is the interesting one, and
 *  it is the only ordering the data supports. Role STRINGS are 3,743 distinct
 *  free-text values, so there is no role filter — only search and this sort. */
export type PersonSort = 'roles' | 'name';
export const PERSON_SORTS: readonly PersonSort[] = ['roles', 'name'];

export interface PersonListQuery {
  q?: string;
  /** Only people with a role at more than one company. */
  multiCompany?: boolean;
  sort?: PersonSort;
  page?: number;
  pageSize?: number;
}
```

**File**: `packages/api/src/domain/identifiers.ts:41-43` — widen:

```ts
/** What an identifier can point at. Funds stay excluded (ingest-only, no page,
 *  degenerate names); people are admitted because Wikidata publishes a QID for
 *  a human exactly as it does for a company. */
export type IdentifiableType = 'company' | 'investor' | 'person';
export const IDENTIFIABLE_TYPES: readonly IdentifiableType[] = ['company', 'investor', 'person'];
```

**File**: `packages/api/src/entry.ts` — `export * from './domain/person';`.

**File**: `packages/api/src/domain/company.ts` — `Person` (the old child interface, `:162`)
gains `personSlug?: string | null` so the company profile can link each card to the profile.
The interface is otherwise unchanged, which keeps `toPerson` and the contribution form
working untouched.

#### 2. Schema
**File**: `packages/db/prisma/schema.prisma`

`model Person` at `:423` is **renamed** to `model PersonRole` and gains four columns:

```prisma
/// One role: a person at a company or an investor firm.
///
/// This is the ORIGINAL `Person` table, renamed in place. Its row ids are
/// unchanged, which is why all 46,394 `Citation` rows with entityType='person'
/// stay anchored and no citation migration is needed. `CitableType`/
/// `ReviewableType` 'person' still means THIS row, exactly as 'investor' means
/// `InvestorHolding` while `Investor` is a separate table.
model PersonRole {
  id String @id @default(cuid())

  /// The deduplicated human. Nullable on the same grounds as
  /// InvestorHolding.investorId: seed phase 002 creates people through a nested
  /// `people: { create: … }` and shipped seed phases are immutable. Every write
  /// path populates it and the Phase 3 backfill fills the seeded rows, so treat
  /// non-null as an invariant.
  personId String?
  person   Person? @relation(fields: [personId], references: [id], onDelete: SetNull)

  /// Exactly one of these is set. companyId stays nullable-free for now — every
  /// existing row has one — and investorId carries the firm-officer edges.
  companyId  String?
  company    Company?  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  investorId String?
  investor   Investor? @relation(fields: [investorId], references: [id], onDelete: Cascade)

  name  String
  role  String
  /// One of ROLE_KINDS, or null when the source's role is free text.
  kind  String?
  since Int
  /// When the role ended, when the source dates it. Null means "no end recorded",
  /// which is not the same as "still there".
  endYear     Int?
  prior       String?
  linkedinUrl String?
  title       String?

  externalSource String?
  externalId     String?

  moderationStatus ReviewStatus @default(PENDING)
  submittedById    String?
  submittedBy      User?        @relation(fields: [submittedById], references: [id], onDelete: SetNull)
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  @@unique([externalSource, externalId])
  @@index([companyId])
  @@index([investorId])
  @@index([personId])
  @@index([moderationStatus])
}

/// A human, deduplicated across every company and firm they appear at.
model Person {
  id   String @id @default(cuid())
  slug String @unique
  name String
  /// normalizeName(name) — the exact-equality dedup key, indexed so the ingest
  /// match index is one query rather than a scan.
  normalizedName String

  roles PersonRole[]

  /// Merge tombstone, identical in purpose to Company/Investor: the row is KEPT
  /// so its slug redirects and its identifiers stay claimed.
  mergedIntoId String?
  mergedInto   Person?  @relation("PersonMerge", fields: [mergedIntoId], references: [id], onDelete: SetNull)
  mergedFrom   Person[] @relation("PersonMerge")

  /// Set when someone asks to be removed (privacy policy §6). A SEPARATE column
  /// from moderationStatus, because ingest auto-APPROVES on every run and would
  /// flip a REJECTED row straight back — the suppression has to be a fact the
  /// ingest match index reads and honours, the same way it honours mergedIntoId.
  suppressedAt DateTime?

  moderationStatus ReviewStatus @default(PENDING)
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  @@index([normalizedName])
  @@index([mergedIntoId])
  @@index([moderationStatus])
}
```

`Company.people` and `Investor` gain/keep `PersonRole[]` back-relations.

#### 3. The migration — hand-written
**File**: `packages/db/prisma/migrations/<ts>_person_entity/migration.sql`

`prisma migrate dev` would generate a DROP + CREATE for a renamed model, destroying 46,961
rows and orphaning 46,394 citations. Generate it with `--create-only` and replace the body:

```sql
ALTER TABLE "Person" RENAME TO "PersonRole";
ALTER INDEX "Person_pkey"                        RENAME TO "PersonRole_pkey";
ALTER INDEX "Person_externalSource_externalId_key" RENAME TO "PersonRole_externalSource_externalId_key";
ALTER INDEX "Person_companyId_idx"               RENAME TO "PersonRole_companyId_idx";
ALTER INDEX "Person_moderationStatus_idx"        RENAME TO "PersonRole_moderationStatus_idx";
-- Constraint names follow the table, so rename them too or a later migration
-- generated by Prisma will not find them.
ALTER TABLE "PersonRole" RENAME CONSTRAINT "Person_companyId_fkey"     TO "PersonRole_companyId_fkey";
ALTER TABLE "PersonRole" RENAME CONSTRAINT "Person_submittedById_fkey" TO "PersonRole_submittedById_fkey";

ALTER TABLE "PersonRole" ALTER COLUMN "companyId" DROP NOT NULL;
ALTER TABLE "PersonRole" ADD COLUMN "personId"   TEXT,
                         ADD COLUMN "investorId" TEXT,
                         ADD COLUMN "kind"       TEXT,
                         ADD COLUMN "endYear"    INTEGER;

CREATE TABLE "Person" ( ... );   -- as generated
-- indexes, FKs as generated
```

Verify the exact existing index and constraint names against `\d "Person"` before writing
the file — they are what Postgres actually assigned, not what Prisma would name today.

Migration name: `person_entity`.

#### 4. Mappers keep compiling
**File**: `apps/api/src/companies/company.mapper.ts:63` — `toPerson` reads `row.personId`'s
person slug when included; every other field is unchanged.
**Files**: `apps/api/src/admin/admin.service.ts:90,176`, `merge.service.ts:68` — the Prisma
delegate is now `tx.personRole`; `COMPANY_CHILDREN`'s `'person'` entry points at it. The
`ReviewableType` string `'person'` does **not** change.

### Success Criteria:

#### Automated Verification:
- [x] `make db-migrate` applies with no data loss: `select count(*) from "PersonRole"` = 46,961 minus Phase 1's purge
- [x] `make db-generate`
- [x] `yarn build`
- [x] `make test`
- [x] `make lint`
- [x] `make db-verify-fresh` — a prod-style rebuild still works
- [x] `select count(*) from "Citation" c join "PersonRole" p on p.id=c."entityId" where c."entityType"='person'` equals the total person citation count (nothing orphaned)

#### Manual Verification:
- [ ] `\d "PersonRole"` shows the renamed indexes and constraints, no leftover `Person_*` names
- [ ] A company profile still renders its people exactly as before the rename
- [ ] The admin queue still lists and approves a pending person contribution

**Implementation Note**: pause here for manual confirmation before Phase 3.

---

## Phase 3: `backfill-people.ts` — collapse roles into people

### Overview
Mint one `Person` per human from the 35,998 surviving role rows, with **no network access**,
and queue the pairs the rule deliberately refuses to collapse.

### Changes Required:

#### 1. The backfill CLI
**File**: `apps/jobs/src/backfill-people.ts` (new)

Same shape as `backfill-identifiers.ts`: application context, keyset pagination
(`cursor` + `skip: 1`, `BATCH = 500`), a progress line per batch, a counts summary.

**Pass 1 — identifier.** For every `PersonRole` with `externalSource = 'WIKIDATA'`, the
person QID is `split_part(externalId, ':', 3)` (measured: 356 rows, 292 distinct QIDs, 356
well-formed). Normalize through `normalizeIdentifier('WIKIDATA', …)`; a value that fails is
counted and skipped, never stored. Look the QID up in `EntityIdentifier`
(`entityType: 'person'`); create the `Person` on a miss and `writeIdentifier` the QID.
This pass alone reunites the 10 QIDs already spanning multiple companies.

**Pass 2 — exact normalized name.** Every remaining role row keys on
`normalizeName(role.name)` — the *matcher's* key, deliberately, not the looser detector key.
First occurrence creates the `Person`; later ones attach. Because the key is global, a name
at nine companies becomes one person, which is what the 9+ bucket measurement says it
should be.

Order matters: identifier before name, so a person whose QID is known keeps that identity
and merely absorbs the name-keyed rows, rather than a name-keyed person being created first
and the QID landing on a second row.

**Slugs.** `uniqueSlug` (`ingest.service.ts:1013`) with the person's name, so `jane-smith`,
`jane-smith-2`, … — the same collision handling companies and investors use.

**Pass 3 — variant candidates.** Group surviving rows by `(companyId, first + ' ' + last)`;
where a group holds more than one distinct normalized full name (measured: **859** groups),
`recordCandidate({ entityType: 'person', signal: 'name', evidence: <the first+last key> })`.
These are the middle-initial and casing variants that exact equality will not merge and a
human should decide. Reuses `identifier.writer.ts:125` unchanged.

`moderationStatus` on a created `Person` is `'APPROVED'` when **any** of its roles is
approved, else `'PENDING'` — a person is public exactly when something public references
them.

#### 2. Ordering
**File**: `Makefile` — `backfill-people` / `backfill-people-prod`; inserted into `ingest-all`
**after** `backfill-identifiers` (it writes person identifiers through the same writer and
wants the table present) and **before** `merge-candidates` and `backfill-citations`.

**File**: `docs/DATA_REBUILD.md` — record the new step and its position.

#### 3. Tests
**File**: `apps/jobs/src/backfill-people.spec.ts` (new) — the pure grouping/keying function,
against fixtures: two Wikidata roles with the same person QID at different companies yield
**one** person; a malformed QID falls through to the name pass rather than being stored; two
roles with the same normalized name yield one person; `Jane Smith` and `Jane A. Smith` at the
same company yield **two** people **and** one candidate; slug collisions increment; a row
already carrying a `personId` is left alone (idempotence).

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `yarn workspace jobs test`
- [x] `make lint`
- [x] `make backfill-people` completes and logs created/attached/candidates
- [x] Re-running `make backfill-people` creates 0 people (idempotent)
- [x] `select count(*) from "PersonRole" where "personId" is null` returns 0
      — returns **1**, and that row is the SBIR PI literally named `. - .`. A name
      that normalizes to nothing yields no identity, which is the honest outcome;
      the invariant holds for every row that has a name.
- [x] `select count(*) from "Person"` is within a few percent of 33,159 (the measured post-purge name-key count)
      — **33,102** people hold a non-SBIR role (0.2% under). The total is 39,107
      because the Phase 1 parser fix added 6,100 SBIR principal investigators
      that did not exist when 33,159 was measured.

#### Manual Verification:
- [ ] The 10 known multi-company Wikidata QIDs each resolve to exactly one person carrying all their roles
- [ ] `paul grossinger` is one person with ~75 roles, not 75 people
- [ ] Spot-check ten `Person` rows against their roles — no obviously-different humans collapsed
- [ ] `select count(*) from "MergeCandidate" where "entityType"='person'` is ≈859 and a sample of five reads as genuine spelling variants

**Implementation Note**: pause here for manual confirmation before Phase 4.

---

## Phase 4: Ingest writes people directly

### Overview
Stop the backfill being load-bearing: every source resolves its people to `Person` rows at
write time, and Wikidata starts contributing the investor side of `PersonRole`.

### Changes Required:

#### 1. The source contract
**File**: `apps/jobs/src/sources/ingestion-source.ts:37-45`

```ts
export interface NormalizedPerson {
  externalId: string;
  name: string;
  role: string;
  /** Set only when the source's role vocabulary is closed and structural — Form
   *  D's `relationship` enum, Wikidata's P112/P169. Never derived by reading a
   *  free-text title. */
  kind?: RoleKind | null;
  since: number;
  endYear?: number | null;
  title?: string | null;
  linkedinUrl?: string | null;
  /** Identifiers for the PERSON, not the role. Only WIKIDATA today. */
  identifiers?: SourceIdentifier[];
}
```

`NormalizedInvestorFirm` gains `people?: NormalizedPerson[]` — the investor half of the join.

#### 2. Sources emit `kind` and identifiers
- **`form-d.parser.ts:92`** — map the closed SEC `relationship` enum:
  `Executive Officer → 'Executive officer'`, `Director → 'Director'`,
  `Promoter → 'Promoter'`. 16,022 rows.
- **`wikidata.mapper.ts:266`** — `P112 → 'Founder'`, `P169 → 'CEO'`, and emit
  `identifiers: [{ scheme: 'WIKIDATA', value: personQid }]`. 356 rows. The `pq:P580` start
  qualifier already read stays `since`; add `pq:P582` as `endYear` in `peopleQuery`.
- **`sec-form-c.source.ts:193`** — emits **no** `kind`. Free-text signature-block titles
  carry no closed vocabulary, and mapping them by string matching is precisely the inference
  this codebase refuses elsewhere.
- **`sbir.parser.ts`** — no `kind`; `Principal investigator` is not a corporate role.

#### 3. Person resolution in the ingest service
**File**: `apps/jobs/src/ingest/ingest.service.ts`

A `PersonIndex` beside `MatchIndex:41` and `InvestorIndex:82`, loaded once per run:

```ts
interface PersonIndex {
  byIdentifier: Map<string, string>;  // `${scheme}:${value}` -> personId
  byName: Map<string, string>;        // normalizeName(name)  -> personId
}
```

`loadPersonIndex()` mirrors `loadInvestorIndex:347`, and — like it — **resolves
`mergedIntoId` and skips `suppressedAt` rows** when building the maps. Resolving the
tombstone is what makes a person merge stick across the next cron run; honouring the
suppression is what makes a removal request stick, since ingest auto-approves and would
otherwise recreate the row on its next pass.

`resolvePerson(p, index)` — modelled line for line on `resolveInvestor:651`:

```ts
// Identifier first for the same reason companies match that way: a QID is a
// statement by the publisher about WHICH human this is. An exactly-equal
// normalized name is a much weaker claim, so it stays behind. Nothing looser
// runs here — variants go to the merge queue, never to an automatic merge.
const personId =
  (await this.matchByIdentifier('person', p.identifiers, index)) ??
  index.byName.get(normalizeName(p.name));
```

On a miss, create the `Person` (slug via `uniqueSlug`), write its identifiers through
`writeIdentifier`, and update the in-memory index so a later record in the same run matches
without a re-query — the pattern the existing `byDomain`/`byName` writes already follow.
A `conflict` outcome from `writeIdentifier` records a `MergeCandidate` and does not
overwrite, exactly as it does for companies.

The existing person block at `:546-556` then writes `personId` and `kind` alongside what it
already writes.

#### 4. Wikidata firm officers
**File**: `apps/jobs/src/sources/wikidata/wikidata.source.ts`

After `investorFirmsQuery()` returns the 368 QID-bearing firms, run the **existing**
`peopleQuery(qids)` (`wikidata.queries.ts:108`) over their QIDs in the same chunked,
~1 req/s throttled way the company pass uses, and attach the results as
`NormalizedInvestorFirm.people`. No new query is written; P112/P169 on a firm are the same
statements as on a company.

`upsertInvestorFirm:689` gains a person block mirroring the company one, writing
`PersonRole` rows with `investorId` set and `companyId` null.

#### 5. Tests
**File**: `apps/jobs/src/ingest/ingest.service.spec.ts` — a person whose QID matches an
existing person attaches a second role instead of creating a duplicate; a person whose name
matches attaches; a person matching neither is created with a unique slug; a role whose
person is a merge tombstone attaches to the survivor; a **suppressed** person is not matched
and not recreated; a QID claimed by a different person records a candidate and does not
overwrite.
**File**: `apps/jobs/src/sources/wikidata/wikidata.mapper.spec.ts` — P112 yields
`kind: 'Founder'` with the person QID as an identifier; P169 yields `'CEO'`; a role with no
recognised property yields `kind: null`.
**File**: `apps/jobs/src/sources/sec-edgar/form-d.parser.spec.ts` — each of the three SEC
relationship values maps to its `RoleKind`; an unrecognised value yields `null`.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `yarn workspace jobs test`
- [x] `make lint`
- [x] `make ingest DAYS=7 LIMIT=50 SOURCE=SEC_EDGAR` writes roles with `kind` set and creates no orphan roles
- [x] Re-running the same window creates no new people
- [x] `make ingest DAYS=1 LIMIT=200 SOURCE=WIKIDATA` writes person identifiers
- [x] `select count(*) from "PersonRole" where "investorId" is not null` is > 0 after an investor-firm run — **80**

#### Manual Verification:
- [ ] An ingest run's log reports people created vs attached, and the ratio looks sane
- [ ] A Wikidata-sourced investor firm shows its founders/CEO
- [ ] A person merged in Phase 5 is not split apart by a subsequent ingest run
- [ ] `select kind, count(*) from "PersonRole" group by 1` shows ~16k structured and the rest null — no Form C row acquired a kind

**Implementation Note**: pause here for manual confirmation before Phase 5.

---

## Phase 5: The merge queue admits people

### Overview
Wire `'person'` through the machinery the identifier crosswalk already built, so the 859
variant candidates and any identifier conflict become decidable.

### Changes Required:

#### 1. The merge service
**File**: `apps/api/src/admin/merge/merge.service.ts`

- `PERSON_CHILDREN = [{ model: 'personRole', column: 'personId' }]` — the same shape as
  `INVESTOR_CHILDREN:82`.
- `side()` (`:161`) gains a person branch: id, slug, name, `externalSource`/`externalId`,
  `createdAt`, identifiers, and counts `{ roles, companies }`. `domain` and `hq` are null —
  a person has neither.
- `mergePerson(tx, survivorId, losingId)`: move `PersonRole.personId`; move
  `EntityIdentifier` rows the survivor lacks and delete-and-record the ones it already
  holds; set `mergedIntoId`. **No `Citation` remap** — person citations anchor to the
  *role* row, whose id never moves. **No `Revision`**, on the `mergeInvestor:433` precedent:
  `Revision.companyId` is required and a person spans many companies.
- `unmergePerson` replays it, recreating the deleted identifiers from `moved`.

#### 2. Detection sweep
**File**: `apps/jobs/src/detect-merges.ts` — a person pass over `(companyId, first+last)`
groups, writing `signal: 'name'` candidates, bounded by the existing `GROUP_LIMIT`
(`merge-detector.ts:35`). This is Phase 3's pass 3 made recurring, sharing `sweep()` so
ordering, signal upgrading and the already-decided guard stay in one place.

Note the asymmetry, and document it: for companies the detector key is *looser* than the
matcher key (`normalizeInvestorName` vs `normalizeName`); for people it is looser along a
different axis — same company, same first+last, different middle. Both exist for the same
reason: the sweep must find what the matcher deliberately would not.

#### 3. Admin API + UI
**File**: `apps/api/src/admin/dto/merge.dto.ts` — `@IsIn([...IDENTIFIABLE_TYPES])` now
admits `'person'` with no edit; verify the DTO reads the constant rather than a literal.
**File**: `apps/web/app/admin/merges/page.tsx` — the type filter gains a `person` chip; the
two-column diff renders the person shape (no domain/HQ row).

#### 4. Tests
**File**: `apps/api/src/admin/merge/merge.service.spec.ts` — roles move; identifiers move
and collide correctly; the loser is tombstoned, not deleted; **no revision is written**;
citations are untouched; the merge/unmerge round trip restores role counts exactly; merging
an already-merged person is refused.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `make test`
- [x] `make lint`
- [x] `make merge-candidates` emits person candidates and re-running writes none — 2,853 pairs → 2,845 rows, unchanged on re-run
- [x] `curl -s -X POST localhost:3000/admin/merges/manual -H 'authorization: Bearer <admin>' -d '{"entityType":"person",...}'` returns a candidate
      (the DTO's fields are `leftId`/`rightId`)
- [x] Merge then unmerge on a scratch pair leaves `PersonRole` counts unchanged
      — 42,315 before, during and after; the tombstone lifts and the candidate
      returns to PENDING

#### Manual Verification:
- [ ] `/admin/merges?type=person` lists the variant pairs and both sides read sensibly
- [ ] Merging two variants gives one person with the union of their roles
- [ ] Unmerging restores both
- [ ] "Not a duplicate" sticks across a re-run of `make merge-candidates`

**Implementation Note**: pause here for manual confirmation before Phase 6.

---

## Phase 6: API — `/people`, `/people/:slug`, suppression

### Overview
The read surface, modelled directly on `investors.*`, plus the tombstone and suppression
filters and the person links on the two existing detail responses.

### Changes Required:

#### 1. Shared filter
**File**: `apps/api/src/prisma/public-filters.ts`

```ts
/** Three conditions, not two. Beyond approved-and-not-merged, a person can be
 *  SUPPRESSED: the privacy policy (§6) promises removal on request, and ingest
 *  auto-approves on every run, so a suppression must be its own column that both
 *  the read path and the ingest match index honour — flipping moderationStatus
 *  would be undone by the next cron. */
export const PUBLIC_PERSON = {
  moderationStatus: 'APPROVED',
  mergedIntoId: null,
  suppressedAt: null,
} satisfies Prisma.PersonWhereInput;
```

#### 2. The service
**File**: `apps/api/src/people/people.service.ts` (new) — mirrors
`investors.service.ts` method for method:

- `findAll(query: PersonListQuery)` — one `$transaction([count, findMany])`; `where` from
  `q` (name contains, insensitive) and `multiCompany`; `orderBy` `roles: { _count: 'desc' }`
  then name, or name alone. Each item carries a bounded `ROLE_SAMPLE` of roles with their
  company/investor slug, the way `PORTFOLIO_SAMPLE` bounds an investor card.
- `findOne(slug)` — full role list, identifiers, and the citations attesting the roles:
  one `citation.findMany({ where: { entityType: 'person', entityId: { in: roleIds } } })`,
  the same bounded-id-list shape `loadFundCitations` uses.
- `redirectOrNotFound` / `resolveMerged` — copied from `investors.service.ts:134-167`,
  including the **no `Location` header** rule: 301 with `redirectTo` in the body, because a
  `Location` would be followed by the web app's server-side fetch and render the survivor
  under the old URL.
- A **suppressed** person is a 404, never a 301. A redirect would confirm the person exists,
  which is the opposite of what a removal request asks for.
- `listSlugs()` for the sitemap, filtered through `PUBLIC_PERSON`.

**File**: `apps/api/src/people/people.controller.ts` (new) — `@Get('sitemap')` declared
**before** `@Get(':slug')`, the ordering `investors.controller.ts` already depends on.
**File**: `apps/api/src/people/person.mapper.ts` (new), `people.module.ts` (new),
registered in `app.module.ts`.

#### 3. People on the two existing detail responses
- `companies.service.ts:45` `approvedChildren.people` includes
  `person: { select: { slug: true, mergedIntoId: true, suppressedAt: true } }`;
  `toPerson` sets `personSlug` only for a live, unsuppressed person — a suppressed person's
  card keeps the name the filing published (that is the citation) but stops linking to a
  profile.
- `investors.service.ts:93` `findOne` includes its `PersonRole[]` so the firm profile can
  list its officers.

#### 4. Suppression endpoint
**File**: `apps/api/src/admin/admin.controller.ts` — `POST /admin/people/:id/suppress` and
`.../unsuppress` under the existing `@Roles('ADMIN')` guard. This is the operational half of
the privacy commitment; without it the promise in `(legal)/privacy/page.tsx` §6 has no
mechanism behind it.

#### 5. Tests
**File**: `apps/api/src/people/people.service.spec.ts` (new) — pagination and both sorts;
`multiCompany` filters; a tombstoned person is absent from the list and from `listSlugs`,
and its slug raises a 301 carrying the survivor's slug; a 5-hop chain resolves and a cycle
terminates; a **suppressed** person 404s rather than redirecting and is absent everywhere.

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `make test`
- [x] `make lint`
- [x] `curl -s 'localhost:3000/people?q=smith&page=1' | jq '.total, (.items|length)'` — 217 / 25
- [x] `curl -s localhost:3000/people/<slug> | jq '.roles|length'` > 0 — `paul-grossinger` returns 75 roles and 69 citations
- [x] `curl -s -o /dev/null -w '%{http_code}' localhost:3000/people/<merged-slug>` → `301`
      (body carries `redirectTo`; **no** `Location` header, verified)
- [x] `curl -s -o /dev/null -w '%{http_code}' localhost:3000/people/<suppressed-slug>` → `404`
- [x] `curl -s localhost:3000/people/sitemap | jq 'length'` > 0 — 39,178

#### Manual Verification:
- [ ] A person at several companies returns all their roles with the right company slugs
- [ ] A Wikidata-sourced firm officer appears under `investor`, not `company`
- [ ] Citations come back attached to the right role
- [ ] Suppressing a person removes them from the list, the profile and the sitemap within the ISR window

**Implementation Note**: pause here for manual confirmation before Phase 7.

---

## Phase 7: Web — `/people` directory, profile, and links

### Overview
The public surface, built from the existing primitives in the parchment-ledger system.

### Changes Required:

#### 1. Data seam
**File**: `apps/web/lib/data.ts` — `getPeople(query)`, `getPerson(slug)`, `getPersonSlugs()`,
following `getInvestors`/`getInvestor`/`getInvestorSlugs`. `getPerson` calls
`permanentRedirect('/people/' + redirectTo)` **inside** the function on a 301, so no call
site needs to know — the pattern documented at `getCompanyDetail`.
**File**: `apps/web/lib/list-params.ts` — `personListQuery(sp)` beside
`investorListQuery:40`, using `PERSON_SORTS`.

#### 2. Directory
**Files**: `apps/web/app/people/page.tsx`, `apps/web/app/people/PeopleDirectory.tsx` (new)

Same split as `/investors`: the server component parses `searchParams`, fetches, and renders
`PageContainer` + `SectionHeader` + the table + `<Pagination>`; the client component only
mirrors filter state to the URL (debounced `router.replace`, page resets on filter change).

Columns: name (link), role count and company count in `font-mono`, and a truncated list of
the companies/firms. **No role filter** — 3,743 distinct free-text role strings is not a
vocabulary, and offering it as one would be a lie about the data.

#### 3. Profile
**File**: `apps/web/app/people/[slug]/page.tsx` (new)

`font-display` name; a mono meta line (role count, company count, first year); `<Identifiers>`
for the Wikidata QID; then roles as a vertical ledger grouped by organisation, each row
carrying role, title, the year range and its `<Citation>` marker — reusing the marker
component so an uncited role reads as an em dash, never as a bare claim.
`generateMetadata` + an `opengraph-image`, matching `/investors/[slug]`.

Strictly monochrome: no accent, no gradients, no pure white, numerals in `font-mono`.

#### 4. Links from the existing profiles
- `apps/web/app/companies/[slug]/page.tsx:277-312` — the person's name becomes a link to
  `/people/<personSlug>` when present, and stays plain text when not. Nothing else in the
  card changes.
- `apps/web/app/investors/[slug]/page.tsx` — a "People" block listing the firm's officers,
  with the same `Empty` state inviting a contribution that the other blocks use.

#### 5. Sitemap
**File**: `apps/web/app/sitemap.ts` — add `/people` to `STATIC_PATHS` and fan out
`getPersonSlugs()` alongside companies and investors.

#### 6. Contribution form
**File**: `apps/web/lib/validation/person.ts` — unchanged shape; the server action's mapper
now resolves the submitted name to a `Person` on approval, mirroring how an approved
`InvestorHolding` publishes its firm (`admin.service.ts:94-103`).

### Success Criteria:

#### Automated Verification:
- [x] `yarn build`
- [x] `make test`
- [x] `make lint`
- [x] `curl -s localhost:3001/people | grep -c 'people/'` > 0 — 25 distinct person links
- [x] `curl -s localhost:3001/sitemap.xml | grep -c '/people/'` > 0 — 39,178 person URLs plus the `/people` index

#### Manual Verification:
- [ ] `/people` search, sort and pagination all drive the URL and survive a reload
- [ ] A serial founder's profile shows every company, and each links correctly
- [ ] A company profile's person card links to the profile; a person with no `personSlug` renders as plain text with no broken link
- [ ] An investor profile lists its officers
- [ ] A merged person's old slug lands on the survivor with the **URL changed**
- [ ] The pages are strictly monochrome, the numerals are mono and aligned, and the layout holds at a narrow width without sideways scroll

---

## Testing Strategy

### Unit tests
- **`apps/jobs`** — the SBIR parser's PI extraction and the `Contact Name` regression guard;
  the backfill's keying (QID before name, variant detection, slug collisions, idempotence);
  ingest person resolution (identifier > name, tombstone follow, suppression honoured,
  conflict → candidate); the Form D and Wikidata `kind` maps.
- **`apps/api`** — `MergeService` person branch, including the round trip and the
  no-revision assertion; `PeopleService` pagination, sorts, 301 and the 404-not-301 rule for
  suppression.
- **`packages/api`** — `IdentifiableType` widening does not break the existing normalizer
  specs.

### Integration
- **Merge a person → re-run ingest → assert they are not split apart.** This proves the
  tombstone resolution in `loadPersonIndex`, and is the person equivalent of the check that
  justified tombstones for companies.
- **Suppress a person → re-run ingest → assert they are not resurrected.** The one test that
  proves the privacy path actually holds, since ingest auto-approves.
- **Purge → re-ingest SBIR → assert no agency name returns.** Proves the Phase 1 parser fix
  and not merely the Phase 1 delete.

### Manual testing steps
1. `make purge-sbir-people`, then check the top SBIR names by company count.
2. `make backfill-people`, then check the person count against the 33,159 name-key estimate
   and hand-check ten collapses.
3. `make merge-candidates`; review five person candidates. If more than one is wrong, tighten
   the variant key before Phase 7 ships.
4. Merge one variant pair through `/admin/merges`; confirm the union of roles, the 301 on the
   old slug, and that `make ingest DAYS=7 SOURCE=SEC_EDGAR` does not undo it.
5. Suppress a person; confirm 404, absence from `/people` and the sitemap, and that the next
   ingest run does not bring them back.

## Performance Considerations

- `loadPersonIndex` adds one `findMany` per ingest run over `Person` (~33k rows) plus the
  person slice of `EntityIdentifier` — the same order as the existing `Company` index load,
  which reads 35,860 rows. No per-record query is added.
- `Person.normalizedName` is indexed, so the name pass is an index probe rather than a scan.
- `/people` list is one `$transaction([count, findMany])` with a bounded role sample, the
  same shape `/investors` already serves.
- `/people/:slug` adds two bounded queries (identifiers, citations over the role id list),
  matching `investors.findOne`.
- The Phase 3 backfill is the heaviest step: ~36k role rows in 500-row batches, single pass,
  comparable to `backfill-identifiers` over ~60k rows.
- The Wikidata firm-officer pass adds 368 QIDs to an already-throttled ~1 req/s query, in the
  same chunking the company pass uses — a few minutes, off the daily cron.

## Migration Notes

- **One migration, `person_entity`, and it must be hand-written.** `prisma migrate dev` emits
  DROP + CREATE for a renamed model; that would destroy 46,961 rows and orphan 46,394
  citations. Generate with `--create-only` and replace the body with the `ALTER TABLE …
  RENAME` shown in Phase 2. Confirm the real index and constraint names with `\d "Person"`
  first.
- **Phase 1 runs before the migration.** Deleting the SBIR rows while they are still plain
  `Person` rows keeps the purge script simple and stops 10,963 useless people being minted.
- **`PersonRole.personId` is nullable and stays nullable.** Seed phase `002` is immutable and
  creates people with no person id. The invariant is maintained by every write path plus the
  backfill, and asserted by the Phase 3 success criterion (`personId is null` → 0), not by
  the database.
- **Citations do not move.** `entityType: 'person'` keeps meaning the role row. The migration
  is not additive — it renames a table — but this decision keeps it *structural only*: no
  row of data is rewritten, so the 46,394 citations need no pass of their own.
- **Back up before Phase 2, then fix forward.** The risk is not that we would want the old
  schema back — it is that hand-written SQL touching 46,961 rows can be *wrong*: a mistyped
  index name aborts the migration halfway, and a mistyped table name loses data. So take a
  dump first (`make deploy-backup` on prod), and treat the dump as the recovery path.
  There is no code-revert path worth planning: the api container runs `prisma migrate
  deploy` on boot from the same image that serves, so there is no window where old code
  meets the new schema, and every phase after 2 is additive.
- **`ingest-all` order** becomes: managers → funds → Form D → Wikidata → Form C → SBIR →
  S-1 → sectors → identifiers → **people** → merge candidates → citations.
- No seed phase is added: people are derived, and seed phases are immutable.

## References

- Original ticket: `thoughts/shared/tickets/2026-08-16-people-first-class.md`
- The machinery this reuses, as the ticket asks:
  `thoughts/shared/plans/2026-09-05-identifier-crosswalk-and-merge.md`
- Prior art for promoting a child row to a first-class entity:
  `thoughts/shared/plans/2026-08-02-investor-entity-and-adv-ingestion.md`
- Prior art for an ingest-only entity and its read path:
  `thoughts/shared/plans/2026-08-30-fund-entity.md`
- Match-and-enrich to model `resolvePerson` on: `apps/jobs/src/ingest/ingest.service.ts:651-800`
- Shared merge writer: `apps/jobs/src/ingest/identifier.writer.ts:66,125`
- Nullable-FK precedent, verbatim: `packages/db/prisma/schema.prisma:401-405`
- No-revision-on-merge precedent: `apps/api/src/admin/merge/merge.service.ts:433`
- Directory/detail service to mirror: `apps/api/src/investors/investors.service.ts`
- Privacy commitment the suppression column implements:
  `apps/web/app/(legal)/privacy/page.tsx` §6
- Rebuild runbook to update: `docs/DATA_REBUILD.md`
