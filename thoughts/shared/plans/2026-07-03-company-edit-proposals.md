# Company Edit Proposals (Propose a Correction) — Implementation Plan

## Overview

Second half of `thoughts/shared/tickets/2026-07-03-submissions.md`: "propose change".
Today the moderation model only handles **new rows** — there is no way to suggest a
correction to existing company data (wrong HQ, stale headcount, missing website…). This
plan adds a full-stack edit-proposal flow: a `ChangeProposal` row holding a field-level
diff against a company, submitted from a pre-filled "Edit details" form on the
contribution hub, reviewed in the admin queue as a field-by-field diff, and **applied to
the company on approval**.

**Depends on** `2026-07-03-company-contribution-hub.md` (the hub page and dropdown this
form plugs into) and builds on `2026-07-03-admin-submission-detail-and-domain.md` (the
expandable `SubmissionDetail` panel the diff view extends). Implement those first.

## Current State Analysis

- Moderation is row-based only: every contributable model carries `moderationStatus`, and
  `AdminService.moderate` just flips that enum (`apps/api/src/admin/admin.service.ts:91-135`).
  Approving never mutates other rows — there is no "apply a change" path anywhere.
- `ReviewableType` is a closed 7-value union (`packages/api/src/domain/moderation.ts:6-13`)
  and `PendingSubmissionsResponse.countsByType` is a `Record<ReviewableType, number>`
  (`moderation.ts:33`) — adding `'proposal'` type-forces every consumer switch/record to
  handle it (good: the compiler finds all sites).
- Company scalar fields live on one row (`packages/db/prisma/schema.prisma:40-90`); money
  is `BigInt` (`totalRaisedUsd`, `lastValuationUsd`), `industry` is `String[]`, vocab
  columns are plain strings validated in DTOs.
- The unlock window is computed from `submittedById` rows across the 7 contributable
  models (`apps/api/src/users/users.service.ts:39-59`), and the user's history from the
  same (`listContributions`, `users.service.ts:74-100`). A proposal must count for both.
- Web-side, the full-company form pattern (all fields, string values, vocab Selects)
  already exists in `CompanyForm` + `companyFormSchema`
  (`apps/web/lib/validation/company.ts`) — the edit form is that, pre-filled, plus link/
  metadata fields and a diff-only mapper.
- `CreateCompanyDto` shows the validator set to mirror for each editable field
  (`apps/api/src/companies/dto/create-company.dto.ts:48-124`).

## Desired End State

- Any signed-in user can open "Edit company details" from the profile's "Propose a
  change ▾" menu, land on `/companies/[slug]/contribute?type=edit` with every field
  pre-filled, change some, optionally cite a source, and submit.
- The submission is stored as a PENDING `ChangeProposal` containing **only the changed
  fields**; it appears in `/admin` (type badge `proposal`, filterable via the Plan-A
  chips) with a Field / Current / Proposed diff panel.
- Approving applies the changes to the `Company` row and marks the proposal APPROVED, in
  one transaction; rejecting just marks it. The public profile reflects approved edits.
- Proposals count as contributions for the 30-day unlock window and show in `/profile`
  history.

### Key Discoveries
- A JSON `changes` column beats per-field proposal columns: one migration, naturally
  sparse, and the editable-field whitelist lives in one DTO. USD values fit safely in JSON
  numbers (same `number` contract as `CreateCompanyInput`); the service converts to
  `BigInt` on apply with the existing `money` helper pattern
  (`apps/api/src/companies/companies.service.ts:41-42`).
- Diffing must be server-authoritative: the web server action re-fetches the company and
  diffs submitted values against **current** values — the client never sends "old" state.
- The admin needs `current` values computed at **list time** (not submit time) so the
  reviewer diffs against what the row says *now*.
- Plan A's admin type chips derive from `Object.keys(countsByType)`, so `proposal`
  appears in the filter with zero extra admin-page work.

## What We're NOT Doing

- No edit proposals for child entities (rounds, people, investors, acquisitions, exits,
  diversity rows) — company scalar fields only. Future ticket.
- No editing of `slug` (stable identity), `financials` (embedded optional group — future),
  or provenance fields (`externalSource`/`externalId`).
- No conflict resolution between competing pending proposals (last approval wins; the
  reviewer sees current values at review time, which is the guard).
- No versioning/audit-history UI of past edits (the proposal rows themselves are the
  audit trail).
- No auto-approval for trusted users.

## Implementation Approach

Bottom-up in four phases: (1) Prisma model + migration; (2) shared types + API (create
endpoint, admin list/apply, unlock accounting) with tests; (3) the pre-filled web form on
the hub; (4) the admin diff panel. Each phase builds and ships independently behind the
previous ones.

---

## Phase 1: `ChangeProposal` model + migration

### Overview
One new table holding a sparse JSON diff per proposal.

### Changes Required

#### 1. Schema
**File**: `packages/db/prisma/schema.prisma`

```prisma
// A proposed correction to an existing Company's fields. `changes` holds only
// the edited fields ({ field: newValue }, whitelisted in the API DTO). Applied
// to the Company row when moderation approves it.
model ChangeProposal {
  id        String  @id @default(cuid())
  companyId String
  company   Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  changes   Json
  note      String?

  moderationStatus ReviewStatus @default(PENDING)
  submittedById    String?
  submittedBy      User?        @relation(fields: [submittedById], references: [id], onDelete: SetNull)
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  @@index([companyId])
  @@index([moderationStatus])
}
```

Add back-relations: `proposals ChangeProposal[]` on `Company` (`schema.prisma:81-86`
block) and on `User` (`schema.prisma:31-37` block).

#### 2. Migration
`yarn workspace @repo/db migrate` (name: `add_change_proposal`), then
`yarn workspace @repo/db generate`.

### Success Criteria

#### Automated Verification
- [ ] Migration applies cleanly on the dev DB: `yarn workspace @repo/db migrate`
- [ ] Client regenerates and everything still builds: `yarn build`
- [ ] Lint passes: `yarn lint`

#### Manual Verification
- [ ] None (schema only).

---

## Phase 2: Shared types + API (create, list, apply, unlock)

### Overview
`'proposal'` becomes a first-class `ReviewableType`: a create endpoint stores diffs;
admin listing includes proposals with current-value context; approval applies the diff
transactionally; proposals count toward the unlock window and history.

### Changes Required

#### 1. Shared types (`@repo/api`)
**File**: `packages/api/src/domain/proposals.ts` (new), re-exported from
`packages/api/src/entry.ts` (match barrel style)

```ts
import type { CompanyStatus, CompanyType, OperatingStatus, Sector, Stage } from './company';

/** Editable Company fields — all optional; a proposal carries only what changed. */
export interface CompanyEditFields {
  name?: string;
  domain?: string;
  oneLiner?: string;
  description?: string;
  hq?: string;
  founded?: number;
  headcount?: number;
  industry?: string[];
  status?: CompanyStatus;
  stage?: Stage;
  totalRaisedUsd?: number;
  lastValuationUsd?: number | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  legalName?: string | null;
  operatingStatus?: OperatingStatus | null;
  companyType?: CompanyType | null;
  primarySector?: Sector | null;
}

export interface CreateChangeProposalInput {
  changes: CompanyEditFields;
  note?: string | null;
}

/** Payload the admin queue carries for a proposal: the diff + live current values. */
export interface ChangeProposalReview {
  changes: CompanyEditFields;
  current: CompanyEditFields; // same keys as `changes`, valued from the Company row now
  note: string | null;
}
```

**File**: `packages/api/src/domain/moderation.ts:6-13` — add `| 'proposal'` to
`ReviewableType`. Build the API app afterwards and fix every place the compiler flags
(`countsByType`, admin switch, users service — all handled below).

#### 2. DTO
**File**: `apps/api/src/companies/dto/create-proposal.dto.ts` (new)

`CompanyEditFieldsDto implements CompanyEditFields`: every field `@IsOptional()` plus the
same validator its `CreateCompanyDto` counterpart uses (`create-company.dto.ts:48-124` —
`@IsString/@MinLength`, `@IsInt/@Min`, `@IsArray`, `@IsIn([...])` for vocab fields,
`@IsUrl` for links). `CreateChangeProposalDto implements CreateChangeProposalInput` with
`@ValidateNested() @Type(() => CompanyEditFieldsDto) changes!` and
`@IsOptional() @IsString() note?`. Unknown keys are stripped globally — the app registers
`new ValidationPipe({ whitelist: true, transform: true })` (`apps/api/src/main.ts:10`) —
so only whitelisted fields can reach the DB.

#### 3. Create endpoint
**Files**: `apps/api/src/companies/companies.controller.ts`,
`apps/api/src/companies/companies.service.ts`

Controller (after `addDiversity`, same guard pattern):
```ts
@UseGuards(JwtAuthGuard)
@Post(':slug/proposals')
propose(@Param('slug') slug, @Body() dto: CreateChangeProposalDto, @CurrentUser() user: RequestUser) {
  return this.companies.proposeChange(slug, dto, user.id);
}
```

Service `proposeChange(slug, dto, userId)`:
- `requireCompany(slug)`.
- Drop `undefined` keys from `dto.changes`; **also drop keys whose value equals the
  company's current value** (defensive no-op strip; compare BigInt columns via `Number`,
  `industry` via join). If nothing remains → `BadRequestException('No changes proposed')`.
- `prisma.changeProposal.create({ data: { companyId, changes: cleaned as Prisma.InputJsonValue, note: dto.note ?? null, moderationStatus: 'PENDING', submittedById: userId } })`;
  return `{ id, moderationStatus }` like the other add* methods.

#### 4. Admin list + apply
**File**: `apps/api/src/admin/admin.service.ts`

- `listSubmissions`: add
  `this.prisma.changeProposal.findMany({ where, include: { submittedBy, company: true }, ...order })`
  to the `Promise.all`; map with
  `this.item('proposal', p, p.company, `Edit ${Object.keys(changes).join(', ')}`, review)`
  where `review: ChangeProposalReview = { changes, current: pickCurrent(p.company, changes), note: p.note }`.
  `pickCurrent` is a small local helper reading the same keys off the company row,
  converting `BigInt → Number` and passing `industry` through — keep the value shapes
  identical to `CompanyEditFields`. Add `proposal: proposals.length` to `countsByType`.
- `moderate`: add `case 'proposal'`:
  - `REJECTED` → status update like the others.
  - `APPROVED` → `prisma.$transaction`: read the proposal (NotFound if missing), build the
    company `data` from its `changes` (BigInt fields through the `money`-style conversion,
    everything else verbatim), `company.update`, then proposal status → APPROVED.
  - Re-approving an already-approved proposal re-applies the same values (idempotent);
    acceptable, matches the flip-freely semantics of the other types.

#### 5. Unlock window + history
**File**: `apps/api/src/users/users.service.ts`

- `lastContributionAt` (`:39-59`): add `this.prisma.changeProposal.findFirst(opts)`.
- `listContributions` (`:74-100`): add the findMany + map to
  `this.toItem('proposal', p, p.company, `Edit: ${Object.keys(...).join(', ')}`)`.

#### 6. Tests
- **Unit** (`apps/api/src/companies/companies.service.spec.ts` or a new
  `proposals.service.spec.ts` beside it, mocked Prisma like the existing spec):
  `proposeChange` strips no-op values, 400s on empty diff, creates PENDING with
  `submittedById`.
- **Unit** (`apps/api/src/admin/` spec, same mocking style): approving a proposal issues a
  transaction that updates the company with converted values (BigInt for
  `totalRaisedUsd`) and flips the proposal; rejecting only flips.
- **E2E** (`apps/api/test/moderation.e2e-spec.ts`, extend): contributor proposes
  `{ hq, headcount }` → admin queue shows a `proposal` item with `current` values → PATCH
  approve → `GET /companies/:slug` reflects the new values.

### Success Criteria

#### Automated Verification
- [ ] Build passes (type-check finds all `ReviewableType` consumers): `yarn build`
- [ ] API unit tests pass: `yarn workspace api test`
- [ ] E2E passes (with a test DB configured): `yarn workspace api test:e2e`
- [ ] Lint passes: `yarn lint`

#### Manual Verification
- [ ] `curl` a proposal as a signed-in user → 201 PENDING; empty/no-op diff → 400.
- [ ] `GET /admin/submissions?status=PENDING` includes the proposal with `changes`,
      `current`, `note`, and `countsByType.proposal`.

**Implementation Note**: pause for manual confirmation before Phase 3.

---

## Phase 3: Pre-filled "Edit details" form on the contribution hub

### Overview
`?type=edit` on the Plan-A hub: the full company form pre-filled from live data, a source
note, and a server action that diffs against current values and submits only the changes.

### Changes Required

#### 1. Validation schema
**File**: `apps/web/lib/validation/proposal.ts` (new)

- `editFormSchema`: `companyFormSchema` (`lib/validation/company.ts:9-39`) **extended
  with** the link/metadata fields it lacks — `websiteUrl`/`linkedinUrl`/`twitterUrl`
  (`urlOrEmpty` from Plan A), `legalName` (opt string), `operatingStatus`/`companyType`
  (vocab enums, `''` allowed = unset) — plus `note` (opt string, max ~500).
- `editDefaultsFromCompany(company: Company): EditFormValues` — numbers → strings,
  `industry.join(', ')`, nulls → `''`.
- `toProposalInput(values, current: Company): CreateChangeProposalInput | null` — map
  values to `CompanyEditFields` shapes (numbers, industry array), compare field-by-field
  against `current`, keep only differences (empty-string optionals compare as `null`);
  return `null` when nothing changed.

#### 2. Submit function
**File**: `apps/web/lib/contribute.ts` — `submitProposal(slug, input)` →
`POST /companies/${slug}/proposals` (clone of `submitRound`).

#### 3. Hub integration
**Files**: `apps/web/app/companies/[slug]/contribute/page.tsx`, `.../actions.ts`,
`.../EditCompanyForm.tsx` (new), `apps/web/app/companies/[slug]/ProposeChangeMenu.tsx`

- Add `'edit'` to the hub's `TYPES` (label "Edit details"); the page already fetches
  `getCompanyDetail`, so pass `company` into `<EditCompanyForm slug company={company} />`
  (defaults via `editDefaultsFromCompany`).
- `EditCompanyForm` (`'use client'`): the shared form shell from Plan A, fields grouped in
  quiet sections — Identity (name, domain, legal name), Profile (one-liner, description,
  HQ, founded, headcount, industry), Classification (status, stage, sector, operating
  status, company type), Capital (total raised, last valuation), Links (website, LinkedIn,
  Twitter) — then "Source / why this change?" (`TextareaField`, optional). Submit label
  "Propose changes"; success copy "Proposal submitted — an admin will review the changes."
- Server action `proposeEditAction(slug, values)`: `editFormSchema.safeParse` →
  re-fetch `getCompanyDetail(slug)` (server-authoritative current) →
  `toProposalInput(parsed, company)`; `null` diff → `{ ok: false, formError: "You haven't changed anything yet." }`;
  else `submitProposal` → `revalidatePath(/companies/${slug})` → `ActionResult`.
- `ProposeChangeMenu`: append a separator + "Edit company details" item →
  `?type=edit`.

### Success Criteria

#### Automated Verification
- [ ] Build passes: `yarn build`
- [ ] Lint passes: `yarn lint`

#### Manual Verification
- [ ] `?type=edit` shows every field pre-filled with live values.
- [ ] Submitting untouched → inline "haven't changed anything" error, no API call.
- [ ] Changing 2 fields submits a 2-key proposal (verify in admin/API); form-level and
      field-level server errors render inline.
- [ ] The dropdown's "Edit company details" item deep-links correctly; signed-out users
      round-trip through login.

**Implementation Note**: pause for manual confirmation before Phase 4.

---

## Phase 4: Admin diff panel

### Overview
Render proposals in the admin queue as a Field / Current / Proposed table inside the
expandable `SubmissionDetail` panel from the admin-detail plan.

### Changes Required

#### 1. Detail renderer
**File**: `apps/web/app/admin/SubmissionDetail.tsx` (from
`2026-07-03-admin-submission-detail-and-domain.md`; if that plan hasn't landed yet,
implement its Phase 2 first — this phase assumes it)

- `case 'proposal'`: narrow `item.data as ChangeProposalReview`; render a three-column
  grid — field label (mono uppercase), current value, `→`, proposed value — one row per
  key of `changes`, formatting money fields via `formatUsd`, counts via `formatCount`,
  `industry` as a comma list, null/empty as `—`. Proposed value emphasized by weight
  (`var(--ink)` + medium), current in `var(--graphite-500)`; strictly monochrome.
- Show `note` beneath the grid ("Submitter's note: …") when present.
- The row `label` already reads `Edit hq, headcount` from the API — no queue-row change.

#### 2. Styles
**File**: `apps/web/app/admin/admin.module.css` — `.diffGrid` (three-column, collapses to
stacked label/current/proposed under 760px) extending the `.detailGrid` treatment.

### Success Criteria

#### Automated Verification
- [ ] Build passes: `yarn build`
- [ ] Lint passes: `yarn lint`

#### Manual Verification
- [ ] Expanding a proposal row shows only the changed fields, current vs proposed, with
      money/date formatting; the note renders when present.
- [ ] Approving applies the change (public profile updates after ISR/refresh) and the row
      moves to Approved; rejecting leaves the company untouched.
- [ ] Plan A's type chips show a `proposal` chip with the right count (derived from
      `countsByType` — no code change expected; just verify).

---

## Testing Strategy

### Unit Tests
- `proposeChange`: no-op strip, empty-diff 400, PENDING create with submitter.
- Admin `moderate('proposal', …)`: transactional apply with BigInt conversion; reject
  path leaves company untouched.
- `lastContributionAt` includes proposal rows (extend existing users spec if present).

### Integration Tests
- E2E (`moderation.e2e-spec.ts`): propose → list (with `current`) → approve → public read
  reflects the edit; reject path.

### Manual Testing Steps
1. `make dev`; sign in as contributor; propose an HQ + headcount change on a seeded
   company with a note.
2. As admin: filter by `proposal`, expand, verify diff + note, approve.
3. Reload the public profile — new HQ/headcount visible; `/profile` shows the proposal in
   history and the unlock window active.
4. Second proposal changing `totalRaisedUsd` (BigInt path) — approve, verify formatting.
5. Reject a third proposal — company unchanged, row in Rejected tab.

## Performance Considerations

Negligible: one extra `findMany` in the admin list `Promise.all`; the apply is a two-step
transaction on a single row. `pickCurrent` reads from the already-included company row.

## Migration Notes

- One additive migration (`ChangeProposal` table); no backfill. Deployed via the existing
  `prisma migrate deploy` on API container boot.
- `ReviewableType` gains `'proposal'`: web and API must deploy together (the web admin
  filter derives chips from the response, so an older web renders the new type safely —
  but the typed `Record<ReviewableType, number>` means both packages should ship from the
  same commit anyway, as usual in this monorepo).

## References

- Ticket: `thoughts/shared/tickets/2026-07-03-submissions.md`
- Prerequisite plans: `thoughts/shared/plans/2026-07-03-company-contribution-hub.md`,
  `thoughts/shared/plans/2026-07-03-admin-submission-detail-and-domain.md`
- Moderation types: `packages/api/src/domain/moderation.ts:6-35`
- Admin list/apply site: `apps/api/src/admin/admin.service.ts:33-135`
- Unlock accounting: `apps/api/src/users/users.service.ts:39-100`
- Company row/fields: `packages/db/prisma/schema.prisma:40-90`;
  validator source: `apps/api/src/companies/dto/create-company.dto.ts:48-124`
- Web form base: `apps/web/lib/validation/company.ts`, `apps/web/app/contribute/CompanyForm.tsx`
