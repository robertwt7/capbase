# Admin Submission Detail View + capbase.fyi Domain Rename — Implementation Plan

## Overview

Two fixes from `thoughts/shared/tickets/2026-07-03-admin-ui.md`:

1. **Admin queue detail view** — moderators can currently only see a one-line label per
   submission; they can't inspect the submitted fields or the submitter before deciding.
   Add an expandable detail panel per queue row showing the full contribution payload and
   the submitter's name + email.
2. **Domain rename** — replace every `capbase.dev` reference with `capbase.fyi`.

## Current State Analysis

- **The API already returns everything needed.** `GET /admin/submissions` builds
  `PendingSubmission` items that carry the full mapped entity in `data` and the submitter
  in `submittedBy: { id, name, email }`:
  - `apps/api/src/admin/admin.service.ts:60-74` — each item is built with the mapper output
    (`toCompany`, `toFundingRound`, …) as `data`.
  - `packages/api/src/domain/moderation.ts:16-29` — `PendingSubmission` shape (`data: unknown`).
- **The web queue drops that data.** `apps/web/app/admin/page.tsx:65-107` renders only
  Type / label + companyName / `submittedBy.name` / date / Approve-Reject. `data` and
  `submittedBy.email` are never rendered. `submittedBy` is `null` for SEC-ingested rows
  (renders `—`), which is correct.
- **Admin page conventions:** server component, no client JS — Approve/Reject are plain
  `<form action={moderateAction.bind(...)}>` server actions (`apps/web/app/admin/actions.ts:13`).
  Styling is the legacy `admin.module.css` (explicitly allowed for admin per `CLAUDE.md`;
  the admin routes are the designated CSS-module island until redesigned).
- **Payload shapes per type** are the shared `@repo/api` domain types, produced by
  `apps/api/src/companies/company.mapper.ts`:
  - `company` → `Company` **without relations** (base fields only: domain, oneLiner,
    description, hq, founded, headcount, industry, status, stage, totalRaisedUsd,
    lastValuationUsd, links, legalName, operatingStatus, companyType, primarySector,
    optional `financials`) — the admin list query doesn't `include` relations
    (`admin.service.ts:35`), and pending child rows are separate queue items anyway.
  - `round` → `FundingRound` (name, date, amountUsd, postMoneyUsd, lead, investors[]).
  - `person` → `Person` (name, role, since, prior?, linkedinUrl, title).
  - `investor` → `InvestorHolding` (name, type, firstRound, rounds, websiteUrl, linkedinUrl).
  - `acquisition` → `AcquisitionDeal` (target, date, amountUsd, rationale).
  - `exit` → `ExitEvent` (type, date, valueUsd, detail).
  - `diversity` → `DiversitySignal` (label, value, note).
- **`capbase.dev` occurrences (7, all seeded-account emails, no URLs):**
  - `docker-compose.yml:35` and `:94` — `ADMIN_EMAIL` default.
  - `packages/db/.env.example:2` — `ADMIN_EMAIL`.
  - `apps/api/.env.example:9` — `ADMIN_EMAIL`.
  - `packages/db/prisma/seed.ts:255` (admin default) and `:264` (`contributor@capbase.dev`).
  - `apps/api/test/moderation.e2e-spec.ts:40` — e2e login uses the seeded admin email.
  - `README.md:61` — documents the demo admin login.

## Desired End State

- On `/admin`, clicking a queue row expands it inline to show every submitted field
  (formatted via `lib/format.ts`) plus a "Submitted by Name <email> · date" line; clicking
  again collapses it. Approve/Reject still work directly from the collapsed row.
- No occurrence of `capbase.dev` remains anywhere in the repo; the seeded admin login is
  `admin@capbase.fyi` and the README/e2e test agree.

### Key Discoveries
- Zero API/schema changes needed for the detail view — `data` + `submittedBy.email` are
  already in the list response and just need rendering (`admin.service.ts:60-74`).
- Native `<details>`/`<summary>` preserves the page's no-client-JS pattern: interactive
  elements (the Approve/Reject submit buttons) inside a `<summary>` capture their own
  activation and do not toggle the disclosure in modern browsers, so the decision buttons
  can stay in the collapsed row. (Manual verification step covers this; fallback is a tiny
  `'use client'` toggle wrapper receiving the server-rendered row/panel as children.)
- The rename is purely email identities, so it changes the demo credentials — existing
  local DBs keep `admin@capbase.dev` until re-seeded (see Migration Notes).

## What We're NOT Doing

- No dedicated detail page (`/admin/submissions/[type]/[id]`) and no new API endpoint —
  the expandable-row option was chosen.
- No admin redesign / migration off `admin.module.css` (explicitly deferred per CLAUDE.md).
- No moderation-flow changes (notes, audit trail, bulk actions, re-review of decided items).
- No `include` of company relations in the admin company query — pending child entities are
  already separate queue items.
- No email-sending / user-facing notifications on approve/reject.

## Implementation Approach

Two independent phases. Phase 1 is the mechanical rename (quick win, isolated blast
radius). Phase 2 adds a server-rendered `SubmissionDetail` component that narrows
`PendingSubmission.data` by `item.type` to the shared domain types and renders a curated
label/value grid, wrapped in a `<details>` disclosure per queue row, styled by extending
`admin.module.css`.

---

## Phase 1: Rename capbase.dev → capbase.fyi

### Overview
Replace all 7 occurrences (all seeded-account emails) across 6 files.

### Changes Required

#### 1. Compose defaults
**File**: `docker-compose.yml` (lines 35, 94)
`ADMIN_EMAIL: ${ADMIN_EMAIL:-admin@capbase.fyi}` in both the `api` and `seed` services.

#### 2. Env examples
**Files**: `packages/db/.env.example:2`, `apps/api/.env.example:9`
`ADMIN_EMAIL="admin@capbase.fyi"`.

#### 3. Seed
**File**: `packages/db/prisma/seed.ts` (lines 255, 264)
Admin fallback → `admin@capbase.fyi`; demo contributor → `contributor@capbase.fyi`.

#### 4. E2E test
**File**: `apps/api/test/moderation.e2e-spec.ts:40`
Login email → `admin@capbase.fyi` (must match the seed).

#### 5. README
**File**: `README.md:61`
Demo credentials line → `admin@capbase.fyi`.

### Success Criteria

#### Automated Verification
- [ ] No stale references: `grep -rn "capbase\.dev" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=dist --exclude-dir=thoughts` returns nothing
- [ ] Build passes: `yarn build`
- [ ] Lint passes: `yarn lint`
- [ ] Re-seed succeeds: `yarn workspace @repo/db seed`

#### Manual Verification
- [ ] After re-seeding, `/admin/login` accepts `admin@capbase.fyi` / `admin12345` and rejects the old email.

**Implementation Note**: pause for manual confirmation before Phase 2.

---

## Phase 2: Expandable submission detail in the admin queue

### Overview
Each queue row becomes a `<details>` disclosure: the collapsed `<summary>` is the current
row (type, label, submitter, date, Approve/Reject); expanding reveals a detail panel with
every submitted field and the full submitter identity.

### Changes Required

#### 1. Per-type detail renderer
**File**: `apps/web/app/admin/SubmissionDetail.tsx` (new — server component)

- `export function SubmissionDetail({ item }: { item: PendingSubmission })`.
- Internal helper builds `{ label, value }[]` per `item.type`, narrowing `item.data`
  (`item.data as Company`, etc. — safe: the API constructs `data` from these exact mappers):
  - **company**: One-liner, Description, Domain, Website / LinkedIn / Twitter (render as
    `<a target="_blank" rel="noreferrer">` when set), Legal name, HQ, Founded, Headcount
    (`formatCount`), Industry, Sector, Stage, Status, Operating status, Company type,
    Total raised (`formatUsd`), Last valuation (`formatUsd`), and — when `financials`
    present — Revenue (`formatUsd`), Revenue growth (`signedPct`), Gross margin, Burn months.
  - **round**: Round, Date (`formatDate`), Amount (`formatUsd`), Post-money (`formatUsd`),
    Lead, Investors (comma list, lead marked "(lead)").
  - **person**: Name, Title, Role, Since, Prior, LinkedIn.
  - **investor**: Name, Type, First round, Rounds participated, Website, LinkedIn.
  - **acquisition**: Target, Date, Amount, Rationale.
  - **exit**: Type, Date, Value, Detail.
  - **diversity**: Label, Value, Note.
- Skip fields whose value is `null`/`''` (keep the panel quiet); numbers/dates always
  through `lib/format.ts` (never inline formatting, per design system).
- Footer line inside the panel: `Submitted by {name} <{email}> · {formatDate(createdAt)}`,
  or `Ingested automatically (no submitter)` when `submittedBy` is null.
- When `item.companySlug` is set (round/person/etc. on an existing approved company), the
  company name in the panel links to `/companies/${item.companySlug}`.

#### 2. Queue rows become disclosures
**File**: `apps/web/app/admin/page.tsx` (lines 65-107)

Replace the row `<div role="row">` with:

```tsx
<details key={`${item.type}-${item.id}`} className={styles.rowDetails}>
  <summary className={styles.row}>
    {/* existing five cells unchanged, plus a chevron affordance in the subject cell */}
  </summary>
  <div className={styles.detailPanel}>
    <SubmissionDetail item={item} />
  </div>
</details>
```

- Keep the Approve/Reject forms inside the summary exactly as today (server actions,
  `moderateAction.bind`).
- Show `submittedBy.email` under the name in the existing "Submitted by" cell (small mono
  line) so the queue itself answers "who".
- Drop `role="table"`/`role="row"` ARIA on the container/rows if they fight the
  `<details>` semantics (a disclosure list is more accurate than a table here); keep the
  header strip as a plain labelled row.

#### 3. Styles
**File**: `apps/web/app/admin/admin.module.css` (extend — this file is the sanctioned
CSS-module island for admin)

- `.rowDetails` — `border-bottom: 1px solid var(--line)`, last-child none (moves the
  border from `.row` up to the disclosure wrapper).
- `summary.row` — `cursor: pointer; list-style: none;` (+ `::-webkit-details-marker { display:none }`),
  hover `background: var(--paper)`.
- `.chevron` — small mono `▸` that rotates via `details[open] &` (pure CSS).
- `.detailPanel` — `padding: 4px 18px 18px; background: var(--paper); border-top: 1px dashed var(--line);`.
- `.detailGrid` — two-column label/value grid: labels uppercase mono 11px
  `var(--graphite-500)` (matches `.rowHead` treatment), values 13px `var(--ink)`;
  single column under the existing 760px breakpoint.
- `.detailFoot` — mono 12px `var(--graphite-500)` submitter line.
- Strictly monochrome throughout — no new colors, emphasis by weight only.

### Success Criteria

#### Automated Verification
- [ ] Build passes: `yarn build`
- [ ] Lint passes: `yarn lint`
- [ ] Web unit/type checks pass via the build (no dedicated web test suite exists)

#### Manual Verification
- [ ] `/admin` (Pending tab): clicking a company row expands it and shows the submitted
      fields (one-liner, domain, HQ, stage, raised, links…) formatted correctly.
- [ ] Submitter shows name **and email** in the row and in the panel; SEC-ingested rows
      show the "ingested automatically" line instead.
- [ ] Clicking **Approve/Reject on a collapsed row does not toggle the disclosure** and
      still moderates correctly (row leaves the Pending tab). If any target browser
      toggles on button click, apply the fallback client-toggle wrapper noted above.
- [ ] Each of the seven types (seed data has examples) renders a sensible panel; null
      fields are omitted, money/dates use the mono formatting.
- [ ] A child submission's company name links to its public profile.
- [ ] Mobile (<760px): rows stack, panel is single-column, nothing overflows.

---

## Testing Strategy

### Unit Tests
- None added: the API is unchanged (existing `admin` coverage stands), and the web app has
  no unit-test harness — the detail renderer is exercised by build/type-check + manual pass.
- Phase 1 touches `moderation.e2e-spec.ts` (email only); run it if a test DB is configured:
  `yarn workspace api test:e2e`.

### Manual Testing Steps
1. `make dev`, re-seed (`yarn workspace @repo/db seed`), log in at `/admin/login` with
   `admin@capbase.fyi` / `admin12345`.
2. Expand one row of each type on the Pending tab; verify fields, formatting, submitter line.
3. Approve one item and Reject another from collapsed rows; confirm no accidental toggle
   and correct tab movement (check Approved/Rejected tabs).
4. Expand rows on the Approved and Rejected tabs (detail must work there too).
5. Run `make ingest` (or view existing SEC rows) to check the no-submitter rendering.

## Performance Considerations

None — the detail data is already fetched by the existing list call; rendering is
server-side and adds no client JS.

## Migration Notes

- The seeded admin/contributor emails change. Existing local/prod DBs keep the old
  `admin@capbase.dev` account until re-seeded (`yarn workspace @repo/db seed`, or the
  compose `seed` profile). If `ADMIN_EMAIL` is set in a real `.env`, update it there too —
  compose/env-example defaults only cover the unset case.

## References

- Ticket: `thoughts/shared/tickets/2026-07-03-admin-ui.md`
- Queue UI: `apps/web/app/admin/page.tsx:65-107`, `apps/web/app/admin/admin.module.css`
- Server actions: `apps/web/app/admin/actions.ts:13`, `apps/web/lib/admin.ts`
- Submission payload construction: `apps/api/src/admin/admin.service.ts:60-74`,
  `apps/api/src/companies/company.mapper.ts`
- Shared types: `packages/api/src/domain/moderation.ts:16-29`, `packages/api/src/domain/company.ts`
- Formatters: `apps/web/lib/format.ts`
