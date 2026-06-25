# User Auth + Contribution-Gated Detail View — Implementation Plan

## Overview

Add public-facing **register / login / profile** pages to `apps/web`, wire up a
**contribution form** for users to submit companies (and their sub-entities), and
gate the **company detail view** so that non-contributors see only a preview
(first 2 rows of each section). Full access is earned by contributing and is kept
alive by a **rolling 30-day window**: a user sees everything only if they have
submitted at least one contribution in the last month.

## Current State Analysis

**API (`apps/api`) — auth and contributions already exist:**
- `POST /auth/register`, `POST /auth/login`, `GET /auth/me` (JWT bearer) — `auth.controller.ts`.
- All contribution endpoints exist behind `JwtAuthGuard`, create `PENDING` rows
  tagged with `submittedById` — `companies.controller.ts:33-99`,
  `companies.service.ts:58-181`. Every contributable row has `submittedById` +
  `createdAt` (`schema.prisma`).
- Public reads are **unauthenticated** and return APPROVED-only data, including all
  detail sections un-truncated — `companies.service.ts:49-56` (`findOneApproved`).
- `JwtAuthGuard` is a bare `AuthGuard('jwt')` that **rejects** missing tokens —
  `auth/guards/jwt-auth.guard.ts`. There is no "optional auth" guard yet.

**Web (`apps/web`) — only the admin auth flow exists:**
- Admin pattern to mirror: `app/api/admin/login/route.ts` proxies `/auth/login` and
  stores the JWT in an httpOnly `capbase_token` cookie; `lib/auth.ts` exposes
  `getToken()`, `getSession()` (`GET /auth/me`), `requireAdmin()`.
- The company detail page renders every section fully with no gating —
  `app/companies/[slug]/page.tsx`. Its empty-state "Add a …" buttons are present but
  inert (`page.tsx:244`).
- `SiteHeader` is a static server component with no session/auth controls —
  `components/SiteHeader.tsx`, rendered once in `app/layout.tsx:41`.
- `lib/data.ts` `getCompany(slug)` fetches `/companies/:slug` with default 60s ISR,
  no auth.

### Key Discoveries
- **No DB migration required.** "Has contributed in the last month" is derived from
  existing `submittedById` + `createdAt` across the 7 contributable models. There is
  no permanent flag to store; the rolling window is a query, which is the single
  source of truth.
- The `capbase_token` cookie + `getSession()` already work for **any** role — only
  the admin *login route* enforces `role === 'ADMIN'` (`api/admin/login/route.ts:29`).
  Regular users can reuse the same cookie + session helpers via a separate login route.
- Shared domain types are the single source of truth (`packages/api/src/domain/*`,
  re-exported via `entry.ts`); both API and web consume them. New response shapes go
  here.
- `UsersModule` already exports `UsersService` (`users.module.ts`), so the gate's
  contribution query can live there and be reused by `CompaniesService`.

## Desired End State

1. A logged-out or non-contributing user browsing a company detail page sees company
   summary + overview + the **first 2 rows** of each section (rounds, people,
   investors, acquisitions, exits, diversity), with a "Contribute to unlock all N"
   prompt. This is enforced **server-side** — hitting the API directly cannot bypass it.
2. After the user submits **any** contribution, the very next detail-page load shows
   **everything**. Access stays unlocked as long as they have submitted something in
   the last 30 days; after 30 days of inactivity it re-locks.
3. Users can **register, log in, view a profile** (their info + access status + their
   submissions), and **submit a new company** and **add a funding round** through the UI.
4. Admins always see full detail (they already review everything).

### Verification
- `curl /companies/:slug` with **no** token → sections truncated to 2 + `access.unlocked=false`.
- `curl /companies/:slug` with a token for a user who contributed in the last 30 days
  → full sections + `access.unlocked=true`.
- Web: register → submit a company → open any company detail → all rows visible.

## What We're NOT Doing
- **No user-submitted market data.** `MarketStat`/`MarketSnapshot` stay seed-only.
- **No DB schema change / migration** (gate is derived, per the chosen approach).
- **No detailed spec for all 6 sub-entity forms.** We build the **new-company** form
  and the **add-funding-round** form concretely; the other 4 sub-entity forms
  (person/investor/acquisition/exit/diversity) reuse the identical pattern and endpoints
  and are a trivial follow-up, left out of scope here.
- No email verification, password reset, OAuth, or refresh tokens.
- No change to the landing/directory pages — they remain fully public (summary data only).
- No client-side token storage; the httpOnly cookie pattern is kept.

## Implementation Approach

Build bottom-up: shared types → API gating + endpoints → web auth → web forms & gated
UI. The gate is a single server-side decision (`access.unlocked`) computed from a
30-day contribution query; the API truncates section arrays before returning them, and
the web simply renders what it receives plus a CTA. Auth on the web reuses the existing
cookie/session machinery, generalized from admin-only to all roles.

---

## Phase 1: Shared response types (`@repo/api`)

### Overview
Add the response shapes for the gated detail endpoint and the profile's "my
contributions" view, plus the gate constants. These are the contract between API and web.

### Changes Required

#### 1. Gate constants + detail/contribution response types
**File**: `packages/api/src/domain/moderation.ts` (or a new `domain/contributions.ts`)
**Changes**: add types and constants; export from `entry.ts` (already a wildcard export
of each domain file, so a new file needs a new `export *` line).

```ts
// Rows shown per detail section to a locked (non-contributing) viewer.
export const PREVIEW_LIMIT = 2;
// Rolling window: a contribution keeps full access alive for this many days.
export const CONTRIBUTION_WINDOW_DAYS = 30;

export interface CompanyAccess {
  /** True if the viewer is an admin or has contributed within the window. */
  unlocked: boolean;
  /** Rows shown per section when locked. */
  previewLimit: number;
  /** ISO timestamp full access expires (latest contribution + window), or null. */
  unlockedUntil: string | null;
  /** Full section counts so a locked UI can say "2 of N". */
  totals: {
    rounds: number; people: number; investors: number;
    acquisitions: number; exits: number; diversity: number;
  };
}

export interface CompanyDetailResponse {
  /** Sections are already truncated to previewLimit when access is locked. */
  company: Company;            // import from './company'
  access: CompanyAccess;
}

export interface MyContribution {
  type: ReviewableType;
  id: string;
  label: string;
  companySlug: string | null;
  companyName: string | null;
  moderationStatus: ReviewStatus;
  createdAt: string;
}

export interface MyContributionsResponse {
  access: { unlocked: boolean; unlockedUntil: string | null };
  items: MyContribution[];
}
```

### Success Criteria

#### Automated Verification
- [x] Types compile / package builds: `yarn workspace @repo/api build`
- [x] Repo type-check passes: `yarn check-types` (or `make build`)

#### Manual Verification
- [x] `CompanyDetailResponse`, `CompanyAccess`, `MyContributionsResponse` import cleanly
      from `@repo/api` in both apps. (verified via Phase 2 API build)

---

## Phase 2: API — optional auth, gated detail, contribution window, my-contributions

### Overview
Make `GET /companies/:slug` auth-aware (optional JWT), truncate sections for locked
viewers, centralize the "recent contribution" query in `UsersService`, and add
`GET /auth/me/contributions` for the profile page.

### Changes Required

#### 1. Optional JWT guard
**File**: `apps/api/src/auth/guards/optional-jwt-auth.guard.ts` (new)
**Changes**: attaches the user when a valid token is present, but does **not** reject
anonymous requests.

```ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // Never throw on missing/invalid token — just return undefined user.
  handleRequest<T = unknown>(_err: unknown, user: T): T {
    return (user || undefined) as T;
  }
}
```

#### 2. Centralize contribution queries in `UsersService`
**File**: `apps/api/src/users/users.service.ts`
**Changes**: add two methods (and `CONTRIBUTION_WINDOW_DAYS`/mappers as needed). The
window cutoff = `now - CONTRIBUTION_WINDOW_DAYS`.

```ts
// True if the user submitted ANY contribution within the window.
async hasRecentContribution(userId: string, since: Date): Promise<boolean> {
  const where = { submittedById: userId, createdAt: { gte: since } };
  const sel = { select: { id: true }, where } as const;
  const found = await Promise.all([
    this.prisma.company.findFirst(sel),
    this.prisma.fundingRound.findFirst(sel),
    this.prisma.person.findFirst(sel),
    this.prisma.investorHolding.findFirst(sel),
    this.prisma.acquisitionDeal.findFirst(sel),
    this.prisma.exitEvent.findFirst(sel),
    this.prisma.diversitySignal.findFirst(sel),
  ]);
  return found.some(Boolean);
}

// Latest contribution timestamp across all types (for unlockedUntil), or null.
async lastContributionAt(userId: string): Promise<Date | null> { /* max createdAt */ }

// All of a user's submissions (any status) → MyContribution[], newest first.
async listContributions(userId: string): Promise<MyContribution[]> { /* … */ }
```

`unlockedUntil = lastContributionAt + CONTRIBUTION_WINDOW_DAYS` (null if none /
expired). `unlocked = now < unlockedUntil`.

#### 3. Gate the company detail in `CompaniesService`
**File**: `apps/api/src/companies/companies.service.ts`
**Changes**: import `UsersService` (add `UsersModule` to `CompaniesModule` imports).
Change `findOneApproved` to accept an optional viewer and return `CompanyDetailResponse`.

```ts
async getCompanyDetail(
  slug: string,
  viewer?: { id: string; role: Role },
): Promise<CompanyDetailResponse> {
  const row = await this.prisma.company.findFirst({
    where: { slug, moderationStatus: 'APPROVED' },
    include: approvedChildren,
  });
  if (!row) throw new NotFoundException(`Company "${slug}" not found`);
  const company = toCompany(row);

  const totals = {
    rounds: company.rounds?.length ?? 0,
    people: company.people?.length ?? 0,
    investors: company.investors?.length ?? 0,
    acquisitions: company.acquisitions?.length ?? 0,
    exits: company.exits?.length ?? 0,
    diversity: company.diversity?.length ?? 0,
  };

  const since = new Date(Date.now() - CONTRIBUTION_WINDOW_DAYS * 86_400_000);
  const isAdmin = viewer?.role === 'ADMIN';
  const unlocked =
    isAdmin || (!!viewer && (await this.users.hasRecentContribution(viewer.id, since)));
  const unlockedUntil = viewer && !isAdmin
    ? (await this.computeUnlockedUntil(viewer.id))
    : null;

  if (!unlocked) {
    for (const k of ['rounds','people','investors','acquisitions','exits','diversity'] as const) {
      if (company[k]) company[k] = company[k]!.slice(0, PREVIEW_LIMIT);
    }
  }
  return { company, access: { unlocked, previewLimit: PREVIEW_LIMIT, unlockedUntil, totals } };
}
```
Keep `findAllApproved` (directory) unchanged — it returns no sections, so the list
stays fully public.

#### 4. Wire the controllers
**File**: `apps/api/src/companies/companies.controller.ts`
```ts
@UseGuards(OptionalJwtAuthGuard)
@Get(':slug')
findOne(@Param('slug') slug: string, @CurrentUser() user?: RequestUser) {
  return this.companies.getCompanyDetail(slug, user);
}
```
(`CurrentUser` returns `req.user`, which is `undefined` for anonymous requests under
the optional guard.)

**File**: `apps/api/src/auth/auth.controller.ts`
```ts
@UseGuards(JwtAuthGuard)
@Get('me/contributions')
async myContributions(@CurrentUser() u: RequestUser): Promise<MyContributionsResponse> {
  const items = await this.users.listContributions(u.id);
  const until = await this.users.computeUnlockedUntil(u.id);
  return { access: { unlocked: !!until && new Date() < new Date(until), unlockedUntil: until }, items };
}
```

#### 5. Module wiring
**File**: `apps/api/src/companies/companies.module.ts` → add `imports: [UsersModule]`.

### Success Criteria

#### Automated Verification
- [x] API builds: `yarn workspace api build`
- [x] Lint passes: `yarn workspace api lint` (0 errors)
- [x] Unit test: locked viewer gets `rounds.length <= 2` and `access.unlocked === false`
- [x] Unit test: viewer with a contribution `createdAt` inside the window →
      `access.unlocked === true` and full-length sections
- [x] Unit test: viewer whose only contribution is **31 days old** → `unlocked === false`
- [x] Unit test: ADMIN viewer → `unlocked === true`
- [x] `yarn workspace api test` passes (8 tests); e2e contract fixed + passing (5 tests)

#### Manual Verification
- [ ] `curl -s localhost:3000/companies/<slug>` (no auth) → 2 rows/section, `unlocked:false`
- [ ] `curl` with `Authorization: Bearer <fresh-contributor-token>` → full sections, `unlocked:true`
- [ ] `curl localhost:3000/auth/me/contributions` with a token lists that user's submissions

**Implementation Note**: After Phase 2 passes automated checks, pause for manual
confirmation (curl checks above) before starting Phase 3.

---

## Phase 3: Web — register, login, profile, session controls

### Overview
Add public auth pages reusing the cookie/session machinery, generalized to all roles.

### Changes Required

#### 1. Route handlers that set the `capbase_token` cookie for any role
**Files** (new):
- `apps/web/app/api/auth/login/route.ts` — proxy `POST /auth/login`, set cookie
  (mirror `api/admin/login/route.ts` but **without** the ADMIN check).
- `apps/web/app/api/auth/register/route.ts` — proxy `POST /auth/register`, set cookie.

#### 2. Session helpers for regular users
**File**: `apps/web/lib/auth.ts`
**Changes**: add `requireUser()` (redirect to `/login` if no session) and a
`logout()` server action target. Keep `requireAdmin()` as-is.

#### 3. Auth pages
**Files** (new), styled with a new `app/(auth)/auth.module.css` (strictly monochrome,
mirroring `admin.module.css`):
- `app/login/page.tsx` — email/password → `POST /api/auth/login` → redirect to `/`
  or `?next=`.
- `app/register/page.tsx` — name/email/password → `POST /api/auth/register` → redirect.
- `app/profile/page.tsx` (server component, `requireUser()`): shows name/email/role;
  fetches `GET /auth/me/contributions`; renders **access status** ("Full access —
  active until <date>" or "Locked — contribute to unlock full profiles") and a table
  of the user's submissions with statuses; "Contribute" + "Sign out" actions.

#### 4. Header auth controls
**File**: `apps/web/components/SiteHeader.tsx`
**Changes**: make it an async server component, read `getSession()`; show **Contribute**
+ **Profile**/email + **Sign out** when signed in, or **Sign in** when not. Keep the
monochrome design (no accent colors).

### Success Criteria

#### Automated Verification
- [ ] Web builds: `yarn workspace web build`
- [ ] Type-check: `yarn workspace web check-types`
- [ ] Lint: `yarn workspace web lint`

#### Manual Verification
- [ ] Register a new user → redirected, header shows signed-in state
- [ ] Log out, log back in → session persists across refresh (httpOnly cookie)
- [ ] `/profile` shows "Locked — contribute…" for a brand-new user
- [ ] Visiting `/profile` while logged out redirects to `/login`
- [ ] Admin login at `/admin/login` still works unchanged

---

## Phase 4: Web — contribution forms + gated detail UI

### Overview
Let users submit a company and a funding round, and render the server-side gate on the
detail page (truncated sections + "contribute to unlock" CTA).

### Changes Required

#### 1. Auth-aware detail fetch
**File**: `apps/web/lib/data.ts`
**Changes**: replace `getCompany` with `getCompanyDetail(slug): Promise<CompanyDetailResponse | undefined>`
that reads the token via `getToken()`, sends `Authorization` when present, and uses
`cache: 'no-store'` (detail is per-user). Update the fallback to wrap the mock company
as `{ company, access: { unlocked: true, … } }` so offline dev still renders.

#### 2. Contribution API client + forms
**Files** (new):
- `apps/web/lib/contribute.ts` — server-side helpers that POST to `/companies` and
  `/companies/:slug/rounds` with the bearer token (mirror `lib/admin.ts`).
- `app/contribute/page.tsx` (`requireUser()`) + `app/contribute/CompanyForm.tsx`
  ('use client') — new-company form typed by `CreateCompanyInput` (`@repo/api`), fields
  for name/domain/oneLiner/description/hq/founded/headcount/industry/status(`COMPANY_STATUSES`)/
  stage(`STAGES`)/totalRaisedUsd. On submit → server action → `POST /companies` →
  redirect to the new company with a "submitted, pending review" notice.
- `app/companies/[slug]/AddRoundForm.tsx` ('use client') typed by `CreateFundingRoundInput`,
  surfaced from the funding-rounds "Add a funding round" empty state / a button (only
  when signed in). Submits to `/companies/:slug/rounds`.

#### 3. Render the gate on the detail page
**File**: `apps/web/app/companies/[slug]/page.tsx`
**Changes**: consume `{ company, access }`. When `!access.unlocked` and a section's
`totals.<section> > access.previewLimit`, render the shown rows plus a locked footer:
"Showing 2 of {total}. Contribute to unlock." linking to `/contribute` (or `/login` if
logged out). Keep the existing empty-state pattern for genuinely empty sections.

### Success Criteria

#### Automated Verification
- [ ] Web builds: `yarn workspace web build`
- [ ] Type-check: `yarn workspace web check-types`
- [ ] Lint: `yarn workspace web lint`

#### Manual Verification
- [ ] Logged-out user on a company with >2 rounds sees exactly 2 + "Showing 2 of N" CTA
- [ ] Submit a new company via `/contribute` → appears in admin queue as PENDING
- [ ] Immediately after submitting, reopen any company detail → all rows now visible
      (unlock is instant on submission)
- [ ] Add a funding round to an existing company → appears in admin queue
- [ ] After approving the user's submission and fast-forwarding past 30 days (or
      manually backdating `createdAt`), the detail view re-locks — confirms the rolling window
- [ ] Whole flow holds the monochrome design (no accent colors/gradients introduced)

---

## Testing Strategy

### Unit Tests (API — Phase 2, the core logic)
- `getCompanyDetail` truncation: locked viewer → each section ≤ `PREVIEW_LIMIT`; totals
  reflect full counts.
- Window boundary: contribution at `now - 29d` → unlocked; at `now - 31d` → locked.
- Anonymous viewer → locked; ADMIN viewer → unlocked.
- `hasRecentContribution` returns true if **any** of the 7 models has a row in-window.

### Integration / Manual
- End-to-end contribution → unlock loop (Phase 4 manual checks).
- Anonymous vs authenticated `curl` against `/companies/:slug`.

## Performance Considerations
- The gate adds up to 7 `findFirst` queries per detail view for authenticated users
  (each `select id`, limit 1). Acceptable at current scale. If it shows up later, add a
  composite index on `(submittedById, createdAt)` or short-cache the per-user unlock
  decision. `submittedById` is currently unindexed — note for future optimization.
- Detail pages become dynamic (`no-store`) for authenticated users; anonymous traffic
  can remain effectively cacheable. The directory/landing keep their 60s ISR.

## Migration Notes
- **No DB migration.** Unlock state is derived from existing columns.
- Existing seeded/ingested data has `submittedById = null`, so it never counts toward a
  user's window — correct (those aren't user contributions).

## References
- Auth API: `apps/api/src/auth/auth.controller.ts`, `auth.service.ts`
- Contribution endpoints: `apps/api/src/companies/companies.controller.ts:33-99`
- Detail read to gate: `apps/api/src/companies/companies.service.ts:49-56`
- Admin auth pattern to mirror: `apps/web/app/api/admin/login/route.ts`, `apps/web/lib/auth.ts`
- Detail page to gate: `apps/web/app/companies/[slug]/page.tsx`
- Shared types: `packages/api/src/domain/*`, `entry.ts`
