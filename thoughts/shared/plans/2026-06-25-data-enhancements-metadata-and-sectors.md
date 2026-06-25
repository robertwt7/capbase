# Data Enhancements: Entity Metadata Links + Sector Connection Implementation Plan

## Overview

Two enhancements to the Capbase domain model, driven by `thoughts/shared/tickets/2026-06-25-data-enhancements.md`:

1. **Metadata enrichment** — add LinkedIn/website (and a few high-value Crunchbase-style) fields to `Company`, `Person`, and `InvestorHolding`, so profiles can link out to the real web.
2. **Sector ↔ company connection** — introduce a shared, controlled **Sector vocabulary** so each `Company` carries a `primarySector` drawn from the same list `MarketStat.sector` uses. This links the two tables that are disconnected today (free-text `Company.industry[]` vs. the standalone seeded `MarketStat` table) **without** rebuilding the seeded aggregate numbers.

## Current State Analysis

A new domain field travels through five layers, in order:

1. `packages/db/prisma/schema.prisma` — column + migration
2. `packages/db/prisma/seed.ts` — seeded literal values
3. `packages/api/src/domain/*.ts` (`@repo/api`) — shared read types (`company.ts`) + write types (`inputs.ts`)
4. `apps/api/src/companies/` — `company.mapper.ts` (db→shared), `dto/*.ts` (validation), `companies.service.ts` (persistence)
5. `apps/web/` — rendering (`app/companies/[slug]/page.tsx`, `app/page.tsx`) + the typed mock fallback in `lib/data.ts`

### Key Discoveries:

- **No entity has any link field today.** `Company` only has `domain` (`schema.prisma:44`), used solely to resolve the Clearbit logo in `components/CompanyLogo.tsx` — it is never rendered as a clickable website.
- **Sector and industry are an unfinished seam, not an intentional split:**
  - `MarketStat` (`schema.prisma:217`) is a standalone table keyed on a `@unique sector` string; its 5 rows and their `dealCount`/`totalRaisedUsd` are hardcoded in `seed.ts:186-191` and returned verbatim by `market.service.ts:11-22` — never computed from companies.
  - `Company.industry` (`schema.prisma:50`) is a free-text `String[]`. The landing renders sector cards from `MarketStat` but the company-row tag from `company.industry[0]` (`app/page.tsx:96`) — two unrelated vocabularies.
  - The 5 canonical sectors are: `Artificial intelligence`, `Fintech`, `Healthcare`, `Climate`, `Enterprise SaaS`.
- **Controlled vocabularies follow a consistent pattern** (not Prisma enums): a TS string-literal union + `readonly` const array in `@repo/api` (e.g. `Stage`/`STAGES`, `CompanyStatus`/`COMPANY_STATUSES` in `domain/company.ts`), stored as a plain `String` column, and validated with `@IsIn([...CONST])` in the DTO (`create-company.dto.ts:67`, `contributions.dto.ts:86`). We will follow this exact pattern for `Sector` (and the two small status vocabularies).
- **Optional-field precedent:** `Company.financials?` and `Person.prior?` are optional in the read types; the mapper includes `prior` only when present (`company.mapper.ts:60`). `lib/data.ts` holds a `Company[]`-typed mock fallback, so making new fields **optional** avoids forcing edits to every mock/seed literal. We adopt `field?: string | null`.
- **DTOs already import `class-validator`;** `@IsOptional`, `@IsIn`, `@IsString` are in use. We add `@IsUrl` for link fields.
- **Ingestion is unaffected:** `apps/jobs` creates companies with `industry` only (`ingest.service.ts:73`); all new fields are optional, so the jobs worker compiles and runs unchanged (new fields default to null on ingested rows).

## Desired End State

- `Company`, `Person`, `InvestorHolding` expose optional link/metadata fields end-to-end (DB → API → web), rendered as outbound links / facts on the profile page.
- A shared `Sector` type + `SECTORS` const exists in `@repo/api`; `Company.primarySector` is constrained to it; the same vocabulary backs `MarketStat.sector`. Seeded companies each get a `primarySector`, and the landing company-row tag prefers `primarySector` (falling back to `industry[0]`).
- `CLAUDE.md` documents the sector vocabulary and the new metadata fields.

**Verification:** migration applies, `yarn build` + `yarn lint` + `make test` pass, and a seeded company profile shows working website/LinkedIn links and a sector tag matching a `MarketStat` card.

## What We're NOT Doing

- **Not** recomputing `MarketStat` aggregates from live company/round data — numbers stay seeded (per the chosen "controlled vocab, keep seeded stats" approach).
- **Not** adding sector filtering/routing on the landing page (e.g. `/?sector=`); the connection is the shared vocabulary + matching tags, nothing more.
- **Not** mapping SEC EDGAR `industryGroup` → `Sector` in `apps/jobs`; ingested rows leave `primarySector` null for now.
- **Not** adding contact email/phone, founders relations, CB Rank/Heat/Growth scores, or social fields to `Person`/`Investor` beyond LinkedIn (+ investor website). Out of scope.
- **Not** touching the moderation/contribution-gating mechanics — new fields inherit each row's existing `moderationStatus`.
- **Not** making any field required (avoids breaking existing rows, ingested data, and mock literals).

## Implementation Approach

Bottom-up, one migration: schema first, then the shared type contracts, then API (mapper/DTO/service), then web. New fields are optional and nullable throughout. Controlled vocabularies (`Sector`, `OperatingStatus`, `CompanyType`) reuse the established string-union + const + `@IsIn` pattern.

**Final field set:**

| Entity | New fields |
|---|---|
| `Company` | `websiteUrl?`, `linkedinUrl?`, `twitterUrl?`, `legalName?`, `operatingStatus?` (`Active`/`Closed`), `companyType?` (`For profit`/`Non-profit`), `primarySector?` (`Sector`) |
| `Person` | `linkedinUrl?`, `title?` |
| `InvestorHolding` | `websiteUrl?`, `linkedinUrl?` |

New `@repo/api` vocabularies: `Sector`/`SECTORS` (the 5 canonical sectors), `OperatingStatus`/`OPERATING_STATUSES`, `CompanyType`/`COMPANY_TYPES`.

---

## Phase 1: Schema, Migration & Shared Types

### Overview
Add the columns and the shared type contracts that every other layer depends on.

### Changes Required:

#### 1. Prisma schema
**File**: `packages/db/prisma/schema.prisma`
**Changes**: Add optional columns. All `String?` (nullable, no default).

```prisma
model Company {
  // ... existing fields ...
  domain      String
  // --- New: outbound links + Crunchbase-style metadata ---
  websiteUrl      String?
  linkedinUrl     String?
  twitterUrl      String?
  legalName       String?
  operatingStatus String?  // 'Active' | 'Closed' (validated in DTO)
  companyType     String?  // 'For profit' | 'Non-profit'
  primarySector   String?  // one of SECTORS; shared vocab with MarketStat.sector
  // ... rest unchanged ...
}

model Person {
  // ... existing fields ...
  prior     String?
  linkedinUrl String?
  title       String?
}

model InvestorHolding {
  // ... existing fields ...
  rounds     Int
  websiteUrl  String?
  linkedinUrl String?
}
```

Create the migration:
```
yarn workspace @repo/db migrate --name add_entity_links_and_primary_sector
```

#### 2. Shared read types
**File**: `packages/api/src/domain/company.ts`
**Changes**: Add the vocabularies and extend interfaces. Place vocab consts near the existing `STAGES`/`COMPANY_STATUSES`.

```typescript
export type Sector =
  | 'Artificial intelligence'
  | 'Fintech'
  | 'Healthcare'
  | 'Climate'
  | 'Enterprise SaaS';

export const SECTORS: readonly Sector[] = [
  'Artificial intelligence',
  'Fintech',
  'Healthcare',
  'Climate',
  'Enterprise SaaS',
];

export type OperatingStatus = 'Active' | 'Closed';
export const OPERATING_STATUSES: readonly OperatingStatus[] = ['Active', 'Closed'];

export type CompanyType = 'For profit' | 'Non-profit';
export const COMPANY_TYPES: readonly CompanyType[] = ['For profit', 'Non-profit'];

export interface Person {
  name: string;
  role: string;
  since: number;
  prior?: string;
  linkedinUrl?: string | null;
  title?: string | null;
}

export interface InvestorHolding {
  name: string;
  type: InvestorType;
  firstRound: string;
  rounds: number;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
}

export interface Company {
  // ... existing fields ...
  domain: string;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  legalName?: string | null;
  operatingStatus?: OperatingStatus | null;
  companyType?: CompanyType | null;
  primarySector?: Sector | null;
  // ... rest unchanged ...
}
```

#### 3. Shared write types
**File**: `packages/api/src/domain/inputs.ts`
**Changes**: Mirror the new fields onto `CreateCompanyInput`, `CreatePersonInput`, `CreateInvestorInput`; import the new vocab types.

```typescript
export interface CreateCompanyInput {
  // ... existing ...
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  legalName?: string | null;
  operatingStatus?: OperatingStatus | null;
  companyType?: CompanyType | null;
  primarySector?: Sector | null;
}

export interface CreatePersonInput {
  // ... existing ...
  linkedinUrl?: string | null;
  title?: string | null;
}

export interface CreateInvestorInput {
  // ... existing ...
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
}
```

Confirm `packages/api/src/entry.ts` re-exports `domain/company` (so `SECTORS` etc. are reachable as `@repo/api`); add exports if the barrel lists members explicitly.

### Success Criteria:

#### Automated Verification:
- [x] Migration applies cleanly: `make db-migrate` (or the `yarn workspace @repo/db migrate --name …` above)
- [x] Prisma client regenerates: `make db-generate`
- [x] Shared types compile: `yarn build` (turbo builds `@repo/api`, `@repo/db`)
- [x] Lint passes: edited files lint clean via root eslint. Pre-existing repo breakages: `@repo/api#lint` (no `eslint` binary in workspace) and `web#lint` (`next lint` removed in Next 16); `api`/`@repo/ui`/`jobs` pass. Unrelated to this change.

#### Manual Verification:
- [ ] New columns exist on `Company`/`Person`/`InvestorHolding` (inspect DB or `prisma studio`).
- [ ] `SECTORS` and `MarketStat.sector` seed values are identical strings.

**Implementation Note**: After automated verification passes, pause for confirmation before Phase 2.

---

## Phase 2: API (Mapper, DTOs, Service) + Seed

### Overview
Surface the new columns through the read mapper, accept + validate them on write, persist them, and give seeded data realistic values.

### Changes Required:

#### 1. Mapper
**File**: `apps/api/src/companies/company.mapper.ts`
**Changes**: Extend `toCompany`, `toPerson`, `toInvestorHolding`. Cast the controlled-vocab columns like existing casts (`row.status as CompanyStatus`). Use `?? undefined` (or conditional spread, matching the existing `prior` pattern) so omitted values stay absent.

```typescript
export function toPerson(row: DbPerson): Person {
  return {
    name: row.name,
    role: row.role,
    since: row.since,
    ...(row.prior ? { prior: row.prior } : {}),
    linkedinUrl: row.linkedinUrl,
    title: row.title,
  };
}

export function toInvestorHolding(row: DbInvestorHolding): InvestorHolding {
  return {
    name: row.name,
    type: row.type as InvestorType,
    firstRound: row.firstRound,
    rounds: row.rounds,
    websiteUrl: row.websiteUrl,
    linkedinUrl: row.linkedinUrl,
  };
}

// in toCompany(...) add to the base object:
//   websiteUrl: row.websiteUrl,
//   linkedinUrl: row.linkedinUrl,
//   twitterUrl: row.twitterUrl,
//   legalName: row.legalName,
//   operatingStatus: row.operatingStatus as OperatingStatus | null,
//   companyType: row.companyType as CompanyType | null,
//   primarySector: row.primarySector as Sector | null,
```

#### 2. DTOs
**File**: `apps/api/src/companies/dto/create-company.dto.ts`
**Changes**: Add validated optional fields to `CreateCompanyDto`. Links use `@IsUrl()`; vocab fields use `@IsIn([...])`.

```typescript
@IsOptional() @IsUrl() websiteUrl?: string | null;
@IsOptional() @IsUrl() linkedinUrl?: string | null;
@IsOptional() @IsUrl() twitterUrl?: string | null;
@IsOptional() @IsString() legalName?: string | null;
@IsOptional() @IsIn([...OPERATING_STATUSES]) operatingStatus?: OperatingStatus | null;
@IsOptional() @IsIn([...COMPANY_TYPES]) companyType?: CompanyType | null;
@IsOptional() @IsIn([...SECTORS]) primarySector?: Sector | null;
```

**File**: `apps/api/src/companies/dto/contributions.dto.ts`
**Changes**: Add to `CreatePersonDto` (`linkedinUrl` `@IsUrl`, `title` `@IsString`) and `CreateInvestorDto` (`websiteUrl`, `linkedinUrl` `@IsUrl`), all `@IsOptional`.

#### 3. Service persistence
**File**: `apps/api/src/companies/companies.service.ts`
**Changes**: Pass the new fields through in `createCompany`, `addPerson`, `addInvestor`. Optional fields map as `dto.field ?? null` (matching the existing `prior: dto.prior ?? null` style).

```typescript
// createCompany data: { ... , websiteUrl: dto.websiteUrl ?? null, linkedinUrl: dto.linkedinUrl ?? null,
//   twitterUrl: dto.twitterUrl ?? null, legalName: dto.legalName ?? null,
//   operatingStatus: dto.operatingStatus ?? null, companyType: dto.companyType ?? null,
//   primarySector: dto.primarySector ?? null }
// addPerson data:   { ... , linkedinUrl: dto.linkedinUrl ?? null, title: dto.title ?? null }
// addInvestor data: { ... , websiteUrl: dto.websiteUrl ?? null, linkedinUrl: dto.linkedinUrl ?? null }
```

#### 4. Seed enrichment
**File**: `packages/db/prisma/seed.ts`
**Changes**: For each of the 8 seeded companies, set a `primarySector` (one of `SECTORS`) plus illustrative `websiteUrl`/`linkedinUrl`, `operatingStatus: 'Active'`, `companyType: 'For profit'`. Add `linkedinUrl` to a few seeded people and `websiteUrl`/`linkedinUrl` to a few investors. The seed `create` call (`seed.ts:240` region) must include the new columns. Suggested sector mapping (fictional companies; adjust by their `industry`): AI-flavored → `Artificial intelligence`, Helia/Meridian (fintech) → `Fintech`, design/productivity → `Enterprise SaaS`, GridPoint (energy) → `Climate`. Every company must get one of the 5 so the landing tag links to a real `MarketStat` card.

#### 5. Service unit test
**File**: `apps/api/src/companies/companies.service.spec.ts`
**Changes**: Extend existing create/add specs to assert the new fields round-trip (e.g. `createCompany` persists `primarySector`/`websiteUrl`; `addPerson` persists `linkedinUrl`). Add a validation expectation that an out-of-vocab `primarySector` / non-URL link is rejected if the spec layer exercises the DTO.

### Success Criteria:

#### Automated Verification:
- [x] Build passes: `yarn build`
- [x] Lint passes: `yarn lint` (same pre-existing `@repo/api#lint` missing-eslint caveat as Phase 1; edited files lint clean via root eslint)
- [x] Unit tests pass: `make test` (10 passed; `npx jest` in apps/api)
- [x] Re-seed succeeds: `make db-seed`

#### Manual Verification:
- [ ] `GET /companies/:slug` returns the new fields for a seeded company (e.g. `curl localhost:3000/companies/helia`).
- [ ] Posting a company with `primarySector: "Nonsense"` or `websiteUrl: "not-a-url"` returns 400.
- [ ] Every seeded company's `primarySector` exactly matches one `MarketStat.sector`.

**Implementation Note**: Pause for confirmation before Phase 3.

---

## Phase 3: Web Rendering + Docs

### Overview
Render the new links/metadata on the profile, use `primarySector` for the landing sector tag, and document the changes.

### Changes Required:

#### 1. Company profile
**File**: `apps/web/app/companies/[slug]/page.tsx`
**Changes**:
- Header: render `websiteUrl`, `linkedinUrl`, `twitterUrl` as outbound links (`target="_blank" rel="noopener noreferrer"`) near the one-liner (`page.tsx:42-49`); only render each when present.
- Facts `<dl>` (`page.tsx:51-56`): add `Legal name`, `Operating status`, `Company type`, `Sector` (= `primarySector`) via the existing `<Fact>` helper, conditionally.
- Investors list (`page.tsx:100-108`): make `inv.name` a link when `inv.websiteUrl`/`inv.linkedinUrl` present.
- People list (`page.tsx:121-130`): render `person.title` alongside `role`, and a LinkedIn link when `person.linkedinUrl` present.

**File**: `apps/web/app/companies/[slug]/profile.module.css`
**Changes**: Add minimal monochrome link styles — keep the "monochrome terminal ledger" rule (no accent color; emphasis via weight/underline only), per `CLAUDE.md`.

#### 2. Landing sector tag
**File**: `apps/web/app/page.tsx`
**Changes**: At `page.tsx:96`, prefer the controlled sector: `{company.primarySector ?? company.industry[0]}`. This makes the row tag share vocabulary with the "Sectors this quarter" cards above.

#### 3. Mock fallback parity (type-only)
**File**: `apps/web/lib/data.ts`
**Changes**: New fields are optional, so existing mock `Company[]` literals still type-check. Optionally add `primarySector` to a couple of mocks so offline-dev parity matches the seed. No required edits.

#### 4. Docs
**File**: `CLAUDE.md`
**Changes**: Under the database/types sections, document (a) the new `Sector` vocabulary shared between `Company.primarySector` and `MarketStat.sector`, noting `MarketStat` numbers remain seeded; (b) the new link/metadata fields on `Company`/`Person`/`InvestorHolding`.

### Success Criteria:

#### Automated Verification:
- [x] Web build passes: `yarn workspace web build` (exit 0) + `tsc --noEmit` (exit 0)
- [x] Lint passes: changed web files lint clean via root eslint. NOTE: repo `yarn lint` has two pre-existing, unrelated breakages — `@repo/api#lint` (no `eslint` binary in that workspace) and `web#lint` (`next lint` was removed in Next 16, so the script mis-parses). `api`/`@repo/ui`/`jobs` lint pass.

#### Manual Verification:
- [ ] A seeded company profile shows clickable website/LinkedIn/Twitter links and the legal-name/status/type/sector facts.
- [ ] Investor and person rows show working LinkedIn links where data exists; rows without links render cleanly (no empty link).
- [ ] The landing company-row sector tag matches one of the "Sectors this quarter" cards.
- [ ] UI remains strictly monochrome — no accent color introduced (per `CLAUDE.md` design system).

---

## Testing Strategy

### Unit Tests:
- `companies.service.spec.ts`: new fields persist on `createCompany`/`addPerson`/`addInvestor`; mapper emits them on read.
- DTO validation: out-of-vocab `primarySector`/`operatingStatus`/`companyType` and malformed URLs are rejected; omitting all new (optional) fields still succeeds.

### Integration Tests:
- `POST /companies` then `GET /companies/:slug` round-trips the new fields (after approval, given moderation gating).

### Manual Testing Steps:
1. `make db-seed`, open a seeded company profile, click each outbound link.
2. Sign in, submit a company with website + LinkedIn + a valid `primarySector`; confirm 201 and PENDING status.
3. Submit with an invalid sector and a bad URL; confirm 400.
4. On the landing page, confirm the row sector tag equals the company's `primarySector` and matches a sector card.

## Performance Considerations

Negligible — additive nullable columns, no new indexes, no new queries. `MarketStat` reads are unchanged (still a flat seeded fetch).

## Migration Notes

Single additive migration; all columns nullable, so existing rows (including SEC-ingested ones) and the `apps/jobs` worker are unaffected and need no backfill. `primarySector` stays null on ingested rows until a future SEC→sector mapping is added.

## References

- Original ticket: `thoughts/shared/tickets/2026-06-25-data-enhancements.md`
- Crunchbase reference HTML: `thoughts/shared/tickets/2026-06-25-data-enhancement.html`
- Disconnected seam: `packages/db/prisma/schema.prisma:50,217`, `apps/api/src/market/market.service.ts:11-22`, `packages/db/prisma/seed.ts:186-191`
- Controlled-vocab pattern: `packages/api/src/domain/company.ts` (`STAGES`), `apps/api/src/companies/dto/create-company.dto.ts:67`
- Field flow reference: `apps/api/src/companies/company.mapper.ts`, `companies.service.ts:120-180`, `apps/web/app/companies/[slug]/page.tsx`
