# Company Contribution Hub (All Entity Types) — Implementation Plan

## Overview

From `thoughts/shared/tickets/2026-07-03-submissions.md`: users can currently only submit
companies (and, half-wired, funding rounds). The profile page shows "Add an investor" /
"Add a team member" / "Add an acquisition" / "Add diversity data" buttons that do nothing,
and once a section has data there is no way to add more. Build a single per-company
contribution hub — a dedicated page at `/companies/[slug]/contribute?type=…` with one form
per entity type — entered via **one** "Propose a change ▾" dropdown at the top right of the
company profile (per ticket: "don't create a button for everything"). Add a type filter to
the admin queue so moderators can slice the (now more varied) submissions.

A companion plan (`2026-07-03-company-edit-proposals.md`) covers proposing *edits to
existing* company data — explicitly out of scope here.

## Current State Analysis

**The backend is complete — zero API changes in this plan.**

- All 7 contribution POST endpoints exist and work (`apps/api/src/companies/companies.controller.ts:40-104`):
  `POST /companies` plus `POST /companies/:slug/{rounds,people,investors,acquisitions,exits,diversity}`,
  all `JwtAuthGuard`ed, all creating `PENDING` rows with `submittedById`
  (`companies.service.ts:103-237`). DTOs for every type: `apps/api/src/companies/dto/contributions.dto.ts`.
- The admin queue already lists and moderates all 7 types (`apps/api/src/admin/admin.service.ts:33-135`)
  and returns `countsByType` (`packages/api/src/domain/moderation.ts:31-35`), which the web
  admin page currently ignores.

**The gap is entirely in `apps/web`:**

- Dead buttons: the `Empty` helper (`app/companies/[slug]/page.tsx:382-396`) renders the
  section action labels as `<Button>` with **no `href` and no `onClick`** — decoration only.
  The Exits empty state (line 241) has no action at all.
- Only 2 of 7 forms exist: `CompanyForm` (`app/contribute/CompanyForm.tsx`, for new
  companies) and the inline `AddRoundForm` (`app/companies/[slug]/AddRoundForm.tsx`,
  rendered only under Funding rounds when signed in — `page.tsx:113-117`).
- `lib/contribute.ts` has only `submitCompany` + `submitRound`; `lib/validation/` has only
  `company.ts` + `round.ts` (+ shared `utils.ts`).
- `components/ui` has no `DropdownMenu` primitive (deps at `apps/web/package.json:15-18`
  include react-label/select/separator/slot only).
- `LockNote` (`page.tsx:287-318`) sends signed-in users to `/contribute` (the *new company*
  form) to unlock — contributing to *this* company would be the more relevant action.

## Desired End State

- Company profile: one "Propose a change ▾" button top-right; its dropdown lists Funding
  round / Investor / Team member / Acquisition / Exit / Diversity data, each linking to
  `/companies/[slug]/contribute?type=…`.
- That page (auth-gated) shows a type-switcher (link tabs) and the matching form; submitting
  creates a PENDING row and shows a success panel. Works whether the section already has
  data or not.
- Every empty-state button on the profile is a real link into the hub with the right type
  preselected. The inline `AddRoundForm` is gone (folded into the hub).
- `/admin` gains per-type filter chips (with counts) alongside the existing status tabs.

**Verification:** from a company page, a signed-in user can submit one of each of the 6
child types; each lands in `/admin` as PENDING (filterable by type); approving makes it
appear on the public profile.

### Key Discoveries

- API + DTOs already accept everything the new forms will send (`companies.controller.ts:40-104`,
  `contributions.dto.ts`); `date` fields are `@IsDateString()` and `<input type="date">`'s
  `YYYY-MM-DD` already passes (proven by the round flow).
- The form pattern to replicate is fully established: string-only zod schema + defaults +
  `to*Input` mapper (`lib/validation/round.ts`), RHF client form with `TextField`/
  `SelectField`/`TextareaField` (`components/ui/fields.tsx`), server action that re-parses
  and returns `ActionResult` (`app/companies/[slug]/actions.ts`).
- Because the hub is a **page**, the profile's dead buttons become plain `href`s — no client
  state plumbing, and auth needs no special handling on the links: the hub itself calls
  `requireUser`, which redirects to `/login?next=…` (`lib/auth.ts:39-45`).
- The admin type filter needs no API change: `countsByType` is already in every
  `GET /admin/submissions` response, scoped to the requested status.
- Vocabularies for the two enum forms: `INVESTOR_TYPES`, `EXIT_TYPES`
  (`packages/api/src/domain/company.ts:58-70`).

## What We're NOT Doing

- No edit proposals for existing data (companion plan `2026-07-03-company-edit-proposals.md`).
- No API/schema/DTO changes at all.
- No multi-investor entry on the round form — it keeps the lead-only mapping
  (`toRoundInput` builds `investors` from `lead`, `lib/validation/round.ts:22-32`).
- No changes to the new-company flow (`/contribute`, `CompanyForm`) or the site header.
- No admin redesign; the type filter extends the sanctioned `admin.module.css` island.
- No notifications/duplicate-detection on submissions.

## Implementation Approach

Four phases, bottom-up: (1) validation schemas + API-client functions, (2) the hub page
with its forms and server actions, (3) rewire the profile page (dropdown, links, remove the
inline round form), (4) admin type filter. Phases 1–2 land the capability; 3 makes it
discoverable; 4 is independent.

---

## Phase 1: Validation schemas + submit functions

### Overview
Give the 5 missing entity types the same `schema + defaults + mapper` treatment as
`round.ts`, and the matching `lib/contribute.ts` POST wrappers.

### Changes Required

#### 1. Shared URL helper
**File**: `apps/web/lib/validation/utils.ts` (extend)

```ts
/** Optional URL field: empty string or a full http(s) URL. */
export const urlOrEmpty = z
  .string()
  .trim()
  .refine((v) => v === '' || /^https?:\/\/\S+\.\S+/.test(v), 'Enter a full URL (https://…).');
```
(Add `import { z } from 'zod'` — the file currently only imports the type.)

#### 2. Five new schema files
**Files**: `apps/web/lib/validation/{person,investor,acquisition,exit,diversity}.ts` (new)

Each exports `*FormSchema`, `*FormValues`, `*FormDefaults`, `to*Input` — string-only values,
digit-string numerics, mapped exactly onto the `@repo/api` `Create*Input`
(`packages/api/src/domain/inputs.ts:49-85`). Follow `round.ts` verbatim in style.

- **person.ts** → `CreatePersonInput`: `name` (min 1), `role` (min 1), `since`
  (`/^\d{4}$/` + realistic-year refine, copy `founded` in `company.ts:23-27`), `prior` (opt
  string), `title` (opt string), `linkedinUrl` (`urlOrEmpty`). Mapper: `since: Number(v.since)`,
  spread-omit empty optionals (round.ts pattern).
- **investor.ts** → `CreateInvestorInput`: `name` (min 1), `type`
  (`z.enum(INVESTOR_TYPES as readonly [string, ...string[]])`, defaults `'Venture'`),
  `firstRound` (min 1, placeholder "Series A"), `rounds` (`/^\d+$/`), `websiteUrl`/
  `linkedinUrl` (`urlOrEmpty`). Mapper: `rounds: Number(...)`, cast `type`.
- **acquisition.ts** → `CreateAcquisitionInput`: `target` (min 1), `date` (min 1), `amountUsd`
  (`/^\d*$/` — optional), `rationale` (min 1). Mapper: omit `amountUsd` when ''.
- **exit.ts** → `CreateExitInput`: `type` (`z.enum(EXIT_TYPES …)`, defaults `'IPO'`), `date`
  (min 1), `valueUsd` (`/^\d*$/`), `detail` (min 1).
- **diversity.ts** → `CreateDiversityInput`: `label`, `value`, `note` (all min 1;
  placeholders e.g. "Women in leadership" / "38%" / one-line context).

#### 3. Submit functions
**File**: `apps/web/lib/contribute.ts` (extend)

Add `submitPerson`, `submitInvestor`, `submitAcquisition`, `submitExit`, `submitDiversity` —
clones of `submitRound` (`lib/contribute.ts:18-26`) hitting
`/companies/${slug}/{people,investors,acquisitions,exits,diversity}` with the matching
`Create*Input` types.

### Success Criteria

#### Automated Verification
- [ ] Build passes: `yarn build`
- [ ] Lint passes: `yarn lint`

#### Manual Verification
- [ ] None (exercised in Phase 2).

---

## Phase 2: `/companies/[slug]/contribute` hub page

### Overview
Auth-gated page with a type switcher and one form per child entity; server actions per
type; success panel. The round action moves here from `app/companies/[slug]/actions.ts`.

### Changes Required

#### 1. Page (server component)
**File**: `apps/web/app/companies/[slug]/contribute/page.tsx` (new)

```tsx
const TYPES = ['round', 'investor', 'person', 'acquisition', 'exit', 'diversity'] as const;
type ContributionType = (typeof TYPES)[number];
const TYPE_LABELS: Record<ContributionType, string> = {
  round: 'Funding round', investor: 'Investor', person: 'Team member',
  acquisition: 'Acquisition', exit: 'Exit', diversity: 'Diversity data',
};
```

- `params: Promise<{ slug }>`, `searchParams: Promise<{ type? }>`; resolve `type`, fall back
  to `'round'` when missing/invalid.
- `await requireUser(`/companies/${slug}/contribute?type=${type}`)` (preserves deep link
  through login).
- `getCompanyDetail(slug)` (`lib/data.ts:361`); `notFound()` on null. Only `company.name`/
  `company.slug` are used.
- Layout (`PageContainer`, monochrome): back link `← {company.name}` →
  `/companies/${slug}`; `SectionHeader title={`Contribute to ${company.name}`}` with a quiet
  note that submissions are reviewed before publishing; type switcher: a row of `<Link>`
  tabs (`?type=…` — mono uppercase 12px, active = `text-ink border-b border-ink`, inactive
  `text-graphite-500`, matching the meta-label treatment); then the active form.

#### 2. Server actions
**File**: `apps/web/app/companies/[slug]/contribute/actions.ts` (new);
**delete** `apps/web/app/companies/[slug]/actions.ts` (its only export moves here)

Six actions — `addRoundAction` moved verbatim, plus `addPersonAction`, `addInvestorAction`,
`addAcquisitionAction`, `addExitAction`, `addDiversityAction`, each the exact shape of the
existing `addRoundAction` (`app/companies/[slug]/actions.ts:9-31`): guard empty slug →
`schema.safeParse` → `fieldErrorsFromZod` on failure → `submit*(slug, to*Input(...))` →
`revalidatePath(`/companies/${slug}`)` → `ActionResult`.

#### 3. Form components (client)
**File**: `apps/web/app/companies/[slug]/contribute/forms.tsx` (new, `'use client'`)

- One exported component per type: `RoundForm`, `InvestorForm`, `PersonForm`,
  `AcquisitionForm`, `ExitForm`, `DiversityForm`, each `({ slug }: { slug: string })`.
- Shared internal shell (in the same file) holding the repeated logic from `AddRoundForm`
  (`AddRoundForm.tsx:14-49` minus the open/close toggle — forms are always open here):
  `useForm({ resolver, defaultValues, mode: 'onBlur' })`, submit handler calling the action,
  `applyServerErrors` + `FormError` on failure, and on success a panel:
  "Submitted for review — it will appear on the profile once an admin approves it." with
  `Button href={`/companies/${slug}`}` ("Back to {company}" ) and a ghost "Add another"
  button that resets the form/state.
- Fields per form (all via `TextField` / `TextareaField` / `SelectField`,
  `components/ui/fields.tsx`; two-column `sm:grid-cols-2` groups like `AddRoundForm`):
  - **Round**: Round / Date (`type="date"`) / Raise (USD) / Post-money (opt) / Lead (opt) —
    identical to today's `AddRoundForm` fields.
  - **Investor**: Name / Type (`SelectField` over `INVESTOR_TYPES`) / First round / Rounds
    participated (`inputMode="numeric"`) / Website (opt) / LinkedIn (opt).
  - **Person**: Name / Role / Title (opt) / Since (year) / Prior affiliation (opt) /
    LinkedIn (opt).
  - **Acquisition**: Target / Date / Amount USD (opt) / Rationale (`TextareaField`).
  - **Exit**: Type (`SelectField` over `EXIT_TYPES`) / Date / Value USD (opt) / Detail
    (`TextareaField`).
  - **Diversity**: Label / Value / Note (`TextareaField`).
- Page maps `type` → component.

#### 4. Delete the inline round form
**File**: delete `apps/web/app/companies/[slug]/AddRoundForm.tsx` (profile references
removed in Phase 3 — do the deletion there if keeping phases independently buildable;
otherwise both in one commit. Simplest: delete file + its `page.tsx` usages in Phase 3.)

### Success Criteria

#### Automated Verification
- [ ] Build passes: `yarn build`
- [ ] Lint passes: `yarn lint`

#### Manual Verification
- [ ] Signed out, `/companies/<slug>/contribute?type=investor` redirects to login and
      returns to the same URL after signing in.
- [ ] Each of the 6 tabs renders its form; each submits successfully and shows the success
      panel; "Add another" resets.
- [ ] Each submission appears in `/admin` Pending with the right type badge; approving it
      makes it render on the public profile (after ISR/refresh).
- [ ] Server-side validation: submitting garbage via devtools (e.g. clearing a required
      field) returns inline errors, not a crash.
- [ ] Unknown slug 404s.

**Implementation Note**: pause for manual confirmation before Phase 3.

---

## Phase 3: Rewire the company profile

### Overview
One dropdown entry point top-right; every dead button becomes a real link; the inline round
form goes away; `LockNote` points at this company's hub.

### Changes Required

#### 1. New primitive: DropdownMenu
**Files**: `apps/web/components/ui/dropdown-menu.tsx` (new via CLI),
`apps/web/components/ui/index.ts`, `apps/web/package.json`

- `npx shadcn@latest add dropdown-menu`, then per CLAUDE.md: rewrite the generated unified
  `radix-ui` import to `@radix-ui/react-dropdown-menu` and add that package as a dependency
  (match the existing pinning style, `package.json:15-18`).
- Re-theme monochrome: content `bg-surface border-line rounded-md shadow-sm`, items
  `text-ink` with `focus:bg-paper` — no accent, no destructive-red variants; strip the
  variants/subcomponents the menu doesn't need only if they carry color, otherwise keep the
  full generated API.
- Export the `DropdownMenu*` parts from `components/ui/index.ts`.

#### 2. Propose-a-change menu
**File**: `apps/web/app/companies/[slug]/ProposeChangeMenu.tsx` (new, `'use client'`)

- `({ slug }: { slug: string })` → `DropdownMenu` with trigger
  `Button variant="primary" shape="pill" size="sm"` labelled `Propose a change` (with a
  `▾` affordance), items = the 6 `TYPE_LABELS` entries as `DropdownMenuItem asChild` →
  `<Link href={`/companies/${slug}/contribute?type=${type}`}>`.
- No auth check here — the hub redirects; signed-out users land on login with `next` set.

#### 3. Profile page wiring
**File**: `apps/web/app/companies/[slug]/page.tsx`

- Top row (line 30-35): wrap the "← All companies" link and `<ProposeChangeMenu slug={…}/>`
  in `flex items-center justify-between` so the button sits top-right per the ticket.
- `Empty` helper (lines 382-396): add a required `href` prop when `action` is set and pass
  it to the `Button` (which already renders `next/link` when given `href`). Call sites:
  - Rounds (104): `?type=round` · Investors (153): `?type=investor` · People (187):
    `?type=person` · Acquisitions (216): `?type=acquisition` · Diversity (267):
    `?type=diversity`.
  - Exits (241): add `action="Record an exit"` + `?type=exit` (currently action-less).
- Remove the `AddRoundForm` import (line 12) and its render block (lines 113-117); delete
  `AddRoundForm.tsx` and the old `actions.ts` (per Phase 2 note).
- `LockNote` (line 312): signed-in href `/contribute` → `/companies/${slug}/contribute`;
  label can stay "Contribute to unlock". Signed-out branch unchanged.

### Success Criteria

#### Automated Verification
- [ ] Build passes: `yarn build`
- [ ] Lint passes: `yarn lint`
- [ ] No orphan references: `grep -rn "AddRoundForm" apps/web` returns nothing

#### Manual Verification
- [ ] "Propose a change ▾" renders top-right on desktop and doesn't wreck the mobile
      (<600px) header stack; menu opens, is fully monochrome, each item deep-links with the
      right `type`.
- [ ] Empty-state buttons on a sparse company navigate into the hub (no more dead buttons);
      populated sections still offer the top-right path.
- [ ] The inline round form is gone; adding a round via the hub still works end-to-end.
- [ ] `LockNote`'s "Contribute to unlock" goes to this company's hub; after submitting,
      the locked sections unlock (30-day window behavior unchanged).

**Implementation Note**: pause for manual confirmation before Phase 4.

---

## Phase 4: Admin queue type filter

### Overview
Filter chips (with counts) above the queue, driven by the `countsByType` the API already
returns; combinable with the existing status tabs. No API change.

### Changes Required

#### 1. Queue page
**File**: `apps/web/app/admin/page.tsx`

- `searchParams` gains `type?: string`; validate against the `ReviewableType` values —
  **derive the chip list from `Object.keys(queue.countsByType)`** rather than a hardcoded
  array, so future types (e.g. the companion plan's `proposal`) appear automatically.
- `const items = activeType ? queue.items.filter((i) => i.type === activeType) : queue.items;`
  (pure page-level filtering of the already-fetched list).
- Chip row between the status tabs and the table: `All ({queue.total})` +
  `{type} ({countsByType[type]})` per type, each a `<Link href={`/admin?status=${active}${t ? `&type=${t}` : ''}`}>`;
  active chip emphasized. Hide chips with a 0 count except the active one.
- Status tab links (lines 40-48) preserve the active `type` param; the header count line
  reflects the filtered count when a type is active.

#### 2. Styles
**File**: `apps/web/app/admin/admin.module.css` (extend — sanctioned island)

`.typeFilter` (flex row, gap, margin under tabs) and `.chip`/`.chipActive` — mono 11px
uppercase, `border: 1px solid var(--line)`, pill radius; active = `border-color: var(--ink)`
+ weight. Strictly monochrome.

### Success Criteria

#### Automated Verification
- [ ] Build passes: `yarn build`
- [ ] Lint passes: `yarn lint`

#### Manual Verification
- [ ] Chips show correct per-type counts for the active status; clicking one narrows the
      table; "All" clears it.
- [ ] Switching status tabs keeps the type filter; an invalid `?type=` in the URL is
      ignored gracefully.
- [ ] Approve/Reject still work on filtered rows.

---

## Testing Strategy

### Unit Tests
- None added: the API is untouched (its existing specs stand) and `apps/web` has no unit
  harness — coverage is build/type-check + the manual pass. (If a web test harness lands
  later, the `to*Input` mappers are the first candidates.)

### Manual Testing Steps
1. `make dev`, seed if needed; register/sign in as a normal user.
2. On a seeded company: open "Propose a change ▾", submit one of each of the 6 types.
3. `/admin` (as `admin@capbase.fyi` if the rename plan has landed, else the seeded admin):
   verify 6 pending items, filter by each type, approve a couple, reject one.
4. Public profile: approved items render in their sections; rejected ones don't.
5. `/profile`: the submissions appear in contribution history; full profiles unlocked.
6. Signed-out pass: profile buttons → login → back to the intended form.

## Performance Considerations

None material: the hub reuses the existing `getCompanyDetail` fetch; admin filtering is an
in-memory filter over an already-fetched list.

## Migration Notes

None — no schema or API changes. The removed inline `AddRoundForm` has no persisted state.

## References

- Ticket: `thoughts/shared/tickets/2026-07-03-submissions.md`
- Companion plans: `thoughts/shared/plans/2026-07-03-company-edit-proposals.md` (edit
  proposals), `thoughts/shared/plans/2026-07-03-admin-submission-detail-and-domain.md`
  (admin detail view — independent, complementary)
- Dead buttons / profile: `apps/web/app/companies/[slug]/page.tsx:104,153,187,216,241,267,382-396`
- Pattern sources: `apps/web/lib/validation/round.ts`, `apps/web/app/companies/[slug]/AddRoundForm.tsx`,
  `apps/web/app/companies/[slug]/actions.ts`, `apps/web/components/ui/fields.tsx`
- API endpoints: `apps/api/src/companies/companies.controller.ts:40-104`;
  DTOs: `apps/api/src/companies/dto/contributions.dto.ts`
- Input types: `packages/api/src/domain/inputs.ts:40-85`; vocabularies:
  `packages/api/src/domain/company.ts:58-70`
- Admin queue: `apps/web/app/admin/page.tsx`, `apps/web/lib/admin.ts`,
  `packages/api/src/domain/moderation.ts:31-35`
