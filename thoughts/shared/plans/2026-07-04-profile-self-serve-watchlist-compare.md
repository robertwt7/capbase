# Profile Self-Serve + Saved Companies + Compare — Implementation Plan

## Overview

Three user-facing features:

1. **Profile self-serve** — signed-in users can edit their name/email and change their
   password from a new `/profile/settings` page.
2. **Saved companies (watchlist)** — a Save/Saved toggle on the company profile header
   and a "Saved companies" section on `/profile`, backed by a new `SavedCompany` model.
3. **Company comparison** — a stateless `/compare?companies=a,b,c` page (max 4) showing
   public summary facts side by side, with entry points from the company page and the
   saved list.

## Current State Analysis

- **Profile page is display-only.** `apps/web/app/(account)/profile/page.tsx` renders
  name/email/role, an access panel, contributions, and sign-out — no editing.
- **No account-update endpoint exists.** `AuthController`
  (`apps/api/src/auth/auth.controller.ts:11-49`) only has `register`, `login`, `me`,
  `me/contributions`. `UsersService` (`apps/api/src/users/users.service.ts`) is
  read/create-only. No `UpdateProfileInput`/`ChangePasswordInput` in `@repo/api`.
- **No watchlist or compare feature anywhere** — no Prisma model, endpoint, type, or UI
  (verified by repo-wide grep for watchlist/favorite/saved/bookmark/compare).
- **User model** (`packages/db/prisma/schema.prisma:23-39`): `id`, `email @unique`,
  `name`, `passwordHash`, `role`, `createdAt` + contribution back-relations. No
  `updatedAt`, no saved-companies relation.

### Key Discoveries

- Sessions resolve by **user id**, not JWT claims: `getSession()`
  (`apps/web/lib/auth.ts:16-27`) round-trips `GET /auth/me`, which re-fetches the DB row
  by `sub` (`apps/api/src/auth/auth.controller.ts:30-34`). So changing email/name does
  **not** invalidate the cookie — the stale `email` claim inside the JWT is harmless.
- Password hashing pattern: `bcrypt.hash(pw, 10)` / `bcrypt.compare`
  (`apps/api/src/auth/auth.service.ts:30,42`); email-conflict pattern:
  pre-check `findByEmail` → `ConflictException('Email already registered')`
  (`auth.service.ts:26-29`).
- Form pattern to clone: `apps/web/lib/validation/round.ts` (schema/defaults/mapper),
  `TextField` wrappers (`apps/web/components/ui/fields.tsx`), server actions returning
  `ActionResult` + `applyServerErrors` (`apps/web/lib/validation/utils.ts:23-35`),
  generic action tail (`apps/web/app/companies/[slug]/contribute/actions.ts:27-58`).
- Authenticated mutation pattern: `getToken()` → `apiFetch(path, { method, headers:
  { authorization: 'Bearer …' }, cache: 'no-store' })` (`apps/web/lib/contribute.ts:16-24`).
- Company page top bar (`apps/web/app/companies/[slug]/page.tsx:30-38`) already hosts
  `ProposeChangeMenu` and fetches `session` — the natural home for Save + Compare buttons.
- The `(account)` pages use legacy CSS Modules; **new UI must be Tailwind + `components/ui`
  primitives** (CLAUDE.md). Hence a separate `/profile/settings` page rather than inlining
  forms into the legacy page.
- zod is **v4** (`^4.4.3`) — use `z.email()` for email validation.
- Prisma migrations: `yarn workspace @repo/db migrate --name <snake_case>`; regenerate the
  client with `yarn workspace @repo/db generate`.

## Desired End State

- `PATCH /auth/me` and `POST /auth/me/password` exist and are JWT-guarded.
- `/profile/settings` (Tailwind) has two working forms; `/profile` links to it.
- `SavedCompany` table exists; `GET/PUT/DELETE /auth/me/saved-companies[/:slug]` work.
- Company page shows Save/Saved (signed-in) and Compare buttons; `/profile` lists saved
  companies with remove + "Compare saved".
- `/compare?companies=a,b` renders a side-by-side facts table with add/remove.
- `yarn lint`, `yarn build`, `yarn workspace api test` all pass.

## What We're NOT Doing

- **No account deletion** (user chose name/email/password scope only).
- **No email verification** on email change, and **no JWT re-issue/invalidation** on
  email or password change — stateless JWTs stay valid until their 7-day expiry. The
  stale-token window is a documented, accepted limitation.
- **No save toggle in the companies directory table** (profile-section option chosen).
- **No persisted comparison basket** — compare state lives entirely in the URL.
- **No gated sections on compare** (rounds/investors/people) — public summary facts only.
- **No redesign of the legacy CSS-module profile page** — we only add a settings link and
  a new Tailwind section to it.
- No rate limiting / password-strength meter / breach checks.

## Implementation Approach

Backend-first per feature, following existing patterns exactly: shared types in
`@repo/api` → NestJS DTO/service/controller → web validation schema → web lib client →
server action → UI. Watchlist endpoints live on `AuthController` under `/auth/me/*`
(mirroring `me/contributions`) with logic in `UsersService`. Compare is web-only.

---

## Phase 1: Profile self-serve — API

### Overview
Add `PATCH /auth/me` (name/email) and `POST /auth/me/password` (verify current password,
set new hash), plus the shared input types.

### Changes Required

#### 1. Shared types
**File**: `packages/api/src/domain/auth.ts` (append)

```ts
export interface UpdateProfileInput {
  name: string;
  email: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}
```

(Already exported via the `entry.ts` barrel's `auth` re-export — verify, no change expected.)

#### 2. DTOs
**File**: `apps/api/src/auth/dto/update-profile.dto.ts` (new)

```ts
import { IsEmail, IsString, MinLength } from 'class-validator';
import type { UpdateProfileInput } from '@repo/api';

export class UpdateProfileDto implements UpdateProfileInput {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;
}
```

**File**: `apps/api/src/auth/dto/change-password.dto.ts` (new)

```ts
import { IsString, MinLength } from 'class-validator';
import type { ChangePasswordInput } from '@repo/api';

export class ChangePasswordDto implements ChangePasswordInput {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
```

#### 3. UsersService update method
**File**: `apps/api/src/users/users.service.ts` (after `create`, ~line 36)

```ts
update(id: string, data: { name?: string; email?: string; passwordHash?: string }) {
  return this.prisma.user.update({ where: { id }, data });
}
```

#### 4. AuthService methods
**File**: `apps/api/src/auth/auth.service.ts`

```ts
/** Update the signed-in user's name/email. Email stays unique. */
async updateProfile(userId: string, dto: UpdateProfileDto): Promise<AuthUser> {
  const existing = await this.users.findByEmail(dto.email);
  if (existing && existing.id !== userId) {
    throw new ConflictException('Email already registered');
  }
  const user = await this.users.update(userId, { name: dto.name, email: dto.email });
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/** Change password after verifying the current one. */
async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
  const user = await this.users.findById(userId);
  if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
    throw new UnauthorizedException('Current password is incorrect');
  }
  const passwordHash = await bcrypt.hash(dto.newPassword, 10);
  await this.users.update(userId, { passwordHash });
}
```

Note: the `findByEmail` pre-check mirrors `register` (`auth.service.ts:26-29`); the DB
`@unique` on `email` backstops the race window (Prisma P2002 → 500, acceptable).

#### 5. Controller endpoints
**File**: `apps/api/src/auth/auth.controller.ts` (add `Patch` import)

```ts
@UseGuards(JwtAuthGuard)
@Patch('me')
updateProfile(
  @CurrentUser() current: RequestUser,
  @Body() dto: UpdateProfileDto,
): Promise<AuthUser> {
  return this.auth.updateProfile(current.id, dto);
}

@UseGuards(JwtAuthGuard)
@Post('me/password')
async changePassword(
  @CurrentUser() current: RequestUser,
  @Body() dto: ChangePasswordDto,
): Promise<{ ok: true }> {
  await this.auth.changePassword(current.id, dto);
  return { ok: true };
}
```

#### 6. Unit tests
**File**: `apps/api/src/auth/auth.service.spec.ts` (new, mirror the mock style of
`apps/api/src/users/users.service.spec.ts`)

- `updateProfile`: rejects when another user owns the email (Conflict); allows keeping
  your own email; returns the mapped `AuthUser`.
- `changePassword`: rejects wrong current password (Unauthorized); hashes and persists
  the new one on success.

### Success Criteria

#### Automated Verification:
- [x] `yarn workspace api test` passes (new auth.service.spec included)
- [x] `yarn lint` passes (strict, zero warnings)
- [x] `yarn build` passes

#### Manual Verification:
- [ ] `PATCH /auth/me` with a Bearer token updates name/email; conflicting email → 409
- [ ] `POST /auth/me/password` with wrong current password → 401; with correct → 200,
      and login works with the new password only
- [ ] Both endpoints → 401 without a token

**Implementation Note**: pause for manual confirmation before Phase 2.

---

## Phase 2: Profile self-serve — Web

### Overview
New `/profile/settings` page (pure Tailwind) with an account-details form and a
change-password form; "Account settings" button on `/profile`.

### Changes Required

#### 1. Validation schemas
**File**: `apps/web/lib/validation/profile.ts` (new; follows `round.ts` style)

```ts
import { z } from 'zod';
import type { AuthUser, ChangePasswordInput, UpdateProfileInput } from '@repo/api';

export const profileFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.'),
  email: z.email('Enter a valid email address.'),
});
export type ProfileFormValues = z.infer<typeof profileFormSchema>;

export function profileDefaultsFromUser(user: AuthUser): ProfileFormValues {
  return { name: user.name, email: user.email };
}
export function toProfileInput(v: ProfileFormValues): UpdateProfileInput {
  return { name: v.name, email: v.email };
}

export const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z.string().min(8, 'Use at least 8 characters.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });
export type PasswordFormValues = z.infer<typeof passwordFormSchema>;
export const passwordFormDefaults: PasswordFormValues = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};
export function toPasswordInput(v: PasswordFormValues): ChangePasswordInput {
  return { currentPassword: v.currentPassword, newPassword: v.newPassword };
}
```

#### 2. API client
**File**: `apps/web/lib/account.ts` (new; clones the `contribute.ts` shape)

```ts
export async function updateProfile(input: UpdateProfileInput) {
  const token = await getToken();
  return apiFetch<AuthUser>('/auth/me', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}

export async function changePassword(input: ChangePasswordInput) {
  const token = await getToken();
  return apiFetch<{ ok: true }>('/auth/me/password', {
    method: 'POST',
    headers: { authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
}
```

#### 3. Server actions
**File**: `apps/web/app/(account)/profile/settings/actions.ts` (new)

Follow `contribute/actions.ts`, but map API statuses to field errors using `ApiError`
(`apps/web/lib/api.ts:7-15`):

- `updateProfileAction(values: unknown): Promise<ActionResult>` — `safeParse` →
  `updateProfile(toProfileInput(data))`; on `ApiError` with `status === 409` return
  `{ ok: false, fieldErrors: { email: 'Email already registered.' } }`; on success
  `revalidatePath('/profile')` + `revalidatePath('/profile/settings')` → `{ ok: true }`.
- `changePasswordAction(values: unknown): Promise<ActionResult>` — `safeParse` →
  `changePassword(toPasswordInput(data))`; on `ApiError` with `status === 401` return
  `{ ok: false, fieldErrors: { currentPassword: 'Current password is incorrect.' } }`.

#### 4. Forms + page
**File**: `apps/web/app/(account)/profile/settings/SettingsForms.tsx` (new, client)

Two Card-wrapped forms using `useForm` + `zodResolver` + `TextField` (password fields use
`type="password"`), `FormError` for the form-level error, `applyServerErrors` on failure.
Success = inline confirmation line (e.g. "Saved." in mono meta style) — the
`ContributionShell` success panel doesn't fit settings. Password form does
`form.reset(passwordFormDefaults)` after success. Account form calls `router.refresh()`
on success so the `SiteHeader` name updates.

**File**: `apps/web/app/(account)/profile/settings/page.tsx` (new, server)

```tsx
export default async function SettingsPage() {
  const user = await requireUser('/profile/settings');
  return (
    <main className="mx-auto max-w-[560px] px-(--page-pad) py-10">
      {/* back link to /profile, h1 "Account settings" (font-display), */}
      {/* <SettingsForms user={user} /> */}
    </main>
  );
}
```

Tailwind + `components/ui` only — no CSS Modules.

#### 5. Link from profile
**File**: `apps/web/app/(account)/profile/page.tsx` (`identityActions` div, ~line 29)

Add `<Button variant="outline" shape="pill" size="sm" href="/profile/settings">Account
settings</Button>` alongside Contribute/Sign out.

### Success Criteria

#### Automated Verification:
- [x] `yarn lint` passes
- [x] `yarn build` passes

#### Manual Verification:
- [ ] `/profile/settings` redirects to `/login?next=…` when signed out
- [ ] Editing name/email persists; header + `/profile` reflect the new name/email
- [ ] Taking another account's email shows the inline email field error
- [ ] Wrong current password shows the inline field error; correct one succeeds, form
      clears, and re-login with the new password works
- [ ] Client-side validation (empty name, bad email, short/mismatched passwords) shows
      inline messages; page is monochrome and consistent with the design system

**Implementation Note**: pause for manual confirmation before Phase 3.

---

## Phase 3: Saved companies — DB + API

### Overview
`SavedCompany` join model + migration; list/status/save/unsave endpoints under
`/auth/me/saved-companies`.

### Changes Required

#### 1. Prisma model
**File**: `packages/db/prisma/schema.prisma`

```prisma
// A company pinned to a user's personal watchlist.
model SavedCompany {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  companyId String
  company   Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([userId, companyId])
  @@index([userId])
}
```

Back-relations: `savedCompanies SavedCompany[]` on both `User` (~line 38) and `Company`
(~line 88).

Migration: `yarn workspace @repo/db migrate --name add_saved_company`, then
`yarn workspace @repo/db generate`.

#### 2. Shared types
**File**: `packages/api/src/domain/watchlist.ts` (new)

```ts
import type { Stage } from './company';

/** A watchlisted company, summarised for the profile list. */
export interface SavedCompanyItem {
  slug: string;
  name: string;
  domain: string;
  oneLiner: string;
  stage: Stage;
  totalRaisedUsd: number;
  savedAt: string; // ISO timestamp
}

export interface SavedStatus {
  saved: boolean;
}
```

Re-export from the barrel (`packages/api/src/entry.ts`).

#### 3. UsersService methods
**File**: `apps/api/src/users/users.service.ts` (add `NotFoundException` import)

```ts
/** The user's saved companies (approved only), newest first. */
async listSavedCompanies(userId: string): Promise<SavedCompanyItem[]> {
  const rows = await this.prisma.savedCompany.findMany({
    where: { userId, company: { moderationStatus: 'APPROVED' } },
    include: {
      company: {
        select: {
          slug: true, name: true, domain: true, oneLiner: true,
          stage: true, totalRaisedUsd: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    slug: r.company.slug,
    name: r.company.name,
    domain: r.company.domain,
    oneLiner: r.company.oneLiner,
    stage: r.company.stage as SavedCompanyItem['stage'],
    totalRaisedUsd: Number(r.company.totalRaisedUsd), // BigInt → number
    savedAt: r.createdAt.toISOString(),
  }));
}

/** Idempotently save an approved company by slug. */
async saveCompany(userId: string, slug: string): Promise<SavedStatus> {
  const company = await this.prisma.company.findFirst({
    where: { slug, moderationStatus: 'APPROVED' },
    select: { id: true },
  });
  if (!company) throw new NotFoundException('Company not found');
  await this.prisma.savedCompany.upsert({
    where: { userId_companyId: { userId, companyId: company.id } },
    create: { userId, companyId: company.id },
    update: {},
  });
  return { saved: true };
}

/** Idempotently remove a saved company by slug. */
async unsaveCompany(userId: string, slug: string): Promise<SavedStatus> {
  await this.prisma.savedCompany.deleteMany({
    where: { userId, company: { slug } },
  });
  return { saved: false };
}

async isCompanySaved(userId: string, slug: string): Promise<boolean> {
  const count = await this.prisma.savedCompany.count({
    where: { userId, company: { slug } },
  });
  return count > 0;
}
```

#### 4. Controller endpoints
**File**: `apps/api/src/auth/auth.controller.ts` (add `Delete`, `Param`, `Put` imports)

```ts
@UseGuards(JwtAuthGuard)
@Get('me/saved-companies')
savedCompanies(@CurrentUser() current: RequestUser): Promise<SavedCompanyItem[]> {
  return this.users.listSavedCompanies(current.id);
}

@UseGuards(JwtAuthGuard)
@Get('me/saved-companies/:slug')
async savedStatus(
  @CurrentUser() current: RequestUser,
  @Param('slug') slug: string,
): Promise<SavedStatus> {
  return { saved: await this.users.isCompanySaved(current.id, slug) };
}

@UseGuards(JwtAuthGuard)
@Put('me/saved-companies/:slug')
saveCompany(
  @CurrentUser() current: RequestUser,
  @Param('slug') slug: string,
): Promise<SavedStatus> {
  return this.users.saveCompany(current.id, slug);
}

@UseGuards(JwtAuthGuard)
@Delete('me/saved-companies/:slug')
unsaveCompany(
  @CurrentUser() current: RequestUser,
  @Param('slug') slug: string,
): Promise<SavedStatus> {
  return this.users.unsaveCompany(current.id, slug);
}
```

#### 5. Unit tests
**File**: `apps/api/src/users/users.service.spec.ts` (extend)

- `saveCompany`: 404 for unknown/unapproved slug; upserts (double-save = one row).
- `unsaveCompany`: idempotent (no throw when nothing to delete).
- `listSavedCompanies`: maps BigInt → number, filters to APPROVED.

### Success Criteria

#### Automated Verification:
- [x] Migration applies cleanly: `yarn workspace @repo/db migrate --name add_saved_company`
- [x] `yarn workspace @repo/db generate` succeeds
- [x] `yarn workspace api test` passes
- [x] `yarn lint` and `yarn build` pass

#### Manual Verification:
- [ ] `PUT` then `GET /auth/me/saved-companies` shows the row; double-`PUT` doesn't duplicate
- [ ] `DELETE` removes it; `GET …/:slug` reports `saved` correctly
- [ ] `PUT` with an unknown slug → 404; all endpoints 401 without a token

**Implementation Note**: pause for manual confirmation before Phase 4.

---

## Phase 4: Saved companies — Web

### Overview
Save/Saved toggle on the company page header; "Saved companies" section on `/profile`
with remove buttons.

### Changes Required

#### 1. Web API client
**File**: `apps/web/lib/watchlist.ts` (new; `contribute.ts` pattern)

- `getSavedCompanies(): Promise<SavedCompanyItem[]>` — GET, bearer, `no-store`
- `getSavedStatus(slug): Promise<SavedStatus>` — GET `…/:slug`
- `saveCompany(slug)` / `unsaveCompany(slug)` — PUT / DELETE

#### 2. Server action
**File**: `apps/web/app/companies/[slug]/actions.ts` (new, `'use server'`)

```ts
export async function setSavedAction(slug: string, saved: boolean): Promise<ActionResult> {
  try {
    if (saved) await saveCompany(slug);
    else await unsaveCompany(slug);
  } catch {
    return { ok: false, formError: 'Could not update your saved list. Are you signed in?' };
  }
  revalidatePath(`/companies/${slug}`);
  revalidatePath('/profile');
  return { ok: true };
}
```

Imported by both the company-page button and the profile section's remove button.

#### 3. Save button
**File**: `apps/web/components/SaveCompanyButton.tsx` (new, client)

Props `{ slug: string; saved: boolean }`. `useTransition` → `setSavedAction(slug, !saved)`;
renders `Button` `variant={saved ? 'primary' : 'outline'}` `shape="pill"` `size="sm"`,
label `Saved` / `Save`, disabled while pending. `revalidatePath` in the action refreshes
the page state after the transition.

#### 4. Company page wiring
**File**: `apps/web/app/companies/[slug]/page.tsx`

- Extend the `Promise.all` (line 19) — saved status only when signed in:
  ```ts
  const [result, session] = await Promise.all([getCompanyDetail(slug), getSession()]);
  const saved = session ? (await getSavedStatus(slug).catch(() => ({ saved: false }))).saved : false;
  ```
- In the top bar (lines 30-38), next to `ProposeChangeMenu`: render
  `{signedIn && <SaveCompanyButton slug={company.slug} saved={saved} />}` (Compare button
  joins it in Phase 5).

#### 5. Profile section
**File**: `apps/web/app/(account)/profile/SavedCompanies.tsx` (new — Tailwind only, no
CSS-module additions)

Renders a "Saved companies" `SectionHeader`-style heading and rows: `CompanyLogo` (small),
name linking to `/companies/[slug]`, `oneLiner` (truncated), `Badge` stage,
`formatUsd(totalRaisedUsd)` in mono, and a ghost "Remove" button (client, calls
`setSavedAction(slug, false)`). Empty state: quiet line inviting saving from company pages.

**File**: `apps/web/app/(account)/profile/page.tsx` — fetch `getSavedCompanies()`
alongside `getMyContributions()` (Promise.all) and render `<SavedCompanies items={…} />`
between the access panel and contributions.

### Success Criteria

#### Automated Verification:
- [x] `yarn lint` and `yarn build` pass

#### Manual Verification:
- [ ] Signed out: no Save button on company pages
- [ ] Signed in: Save toggles to Saved (and back) without a reload; state survives refresh
- [ ] Saved companies appear on `/profile`, newest first; Remove works from the profile
- [ ] Company logo/name/stage/raised render correctly in the section

**Implementation Note**: pause for manual confirmation before Phase 5.

---

## Phase 5: Compare — Web only

### Overview
Stateless `/compare?companies=a,b,c` page (cap 4): side-by-side public summary facts,
add/remove via URL, entry points on the company page and saved section.

### Changes Required

#### 1. Compare page
**File**: `apps/web/app/compare/page.tsx` (new, server)

```tsx
export const metadata = { title: 'Compare companies' };

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ companies?: string }>;
}) {
  const { companies: raw } = await searchParams;
  const all = await getCompanies(); // public summary list, 60s ISR
  const slugs = [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 4);
  const selected = slugs
    .map((s) => all.find((c) => c.slug === s))
    .filter((c): c is Company => Boolean(c)); // unknown slugs silently dropped
  // …render
}
```

- **Empty state** (0 selected): `EmptyState` + the picker.
- **Table**: wrapped in `overflow-x-auto`; first column = fact labels (mono uppercase
  meta), one column per company. Column header: `CompanyLogo` + name (link) + a small "×"
  `Link` whose `href` is `/compare?companies=` minus that slug. Fact rows (all from the
  base `Company` type, formatted via `lib/format.ts`):
  Sector (`primarySector ?? '—'`), Stage, Status, Founded, HQ,
  Headcount (`formatCount`), Total raised (`formatUsd`), Last valuation (`formatUsd` —
  already null-safe, cf. company page line 85). Numbers `font-mono`; monochrome
  throughout; the grid uses `border-line` / `bg-surface` panel styling like the company
  facts panel (`page.tsx:14-15`).
- Picker rendered below the table while fewer than 4 companies are selected.

#### 2. Picker
**File**: `apps/web/app/compare/ComparePicker.tsx` (new, client)

Props `{ options: { slug: string; name: string }[]; current: string[] }` (server page
passes `all` minus `selected`, sorted by name). Uses the Radix `Select` primitives; on
`onValueChange`, `router.push('/compare?companies=' + [...current, slug].join(','))`.
Hidden/disabled when `current.length >= 4` with a mono note "Up to 4 companies".

#### 3. Entry points
- **Company page top bar** (`apps/web/app/companies/[slug]/page.tsx:30-38`): add
  `<Button variant="outline" shape="pill" size="sm"
  href={`/compare?companies=${company.slug}`}>Compare</Button>` beside the Save button
  (visible to everyone — compare is public).
- **Profile saved section** (`SavedCompanies.tsx`): when ≥2 items, a "Compare saved"
  `Button` linking to `/compare?companies=` + first 4 saved slugs.

### Success Criteria

#### Automated Verification:
- [x] `yarn lint` and `yarn build` pass

#### Manual Verification:
- [ ] `/compare` (no params) shows the empty state + picker
- [ ] Adding via picker updates the URL and the table; "×" removes a column
- [ ] Unknown/duplicate slugs in the URL are ignored; a 5th slug is dropped (cap 4)
- [ ] URL is shareable — pasting it in a fresh session reproduces the comparison
- [ ] Table scrolls horizontally on narrow screens without breaking the page
- [ ] Entry buttons on company page and profile saved section navigate correctly

---

## Testing Strategy

### Unit Tests (apps/api, jest):
- `auth.service.spec.ts` (new): `updateProfile` email-conflict / self-email / happy path;
  `changePassword` wrong-current / happy path (assert bcrypt hash stored, not plaintext).
- `users.service.spec.ts` (extend): save (404 unknown slug, idempotent upsert), unsave
  (idempotent), list (APPROVED filter, BigInt mapping).

### Integration:
- None automated in this repo today; API endpoints exercised manually via curl (see
  per-phase manual steps).

### Manual Testing Steps:
1. Register a fresh user → `/profile` → Account settings → change name, email, password;
   sign out; sign back in with new email + new password.
2. Save 3 companies from their pages; verify `/profile` list order and Remove.
3. From a company page hit Compare, add 2 more via picker, remove one via "×", share the
   URL to an incognito window.
4. Regression: contribute flow, admin login, and company profile gating still work
   (auth surface was touched).

## Performance Considerations

- Compare uses the cached public `getCompanies()` list (60s ISR) — no new endpoints, no
  N+1 detail fetches.
- Saved-status fetch on the company page is one small authed GET, only when signed in.
- `listSavedCompanies` is a single query with a narrow `select`.

## Migration Notes

- One additive migration (`SavedCompany` table + FKs + unique/index). No data backfill,
  no changes to existing tables beyond back-relations (relation fields are virtual — no
  SQL impact on `User`/`Company`).
- Deploys cleanly via the existing `prisma migrate deploy` on API container boot.

## References

- Ticket: `thoughts/shared/tickets/2026-07-04-profile-self-serve.md`
- Auth endpoints: `apps/api/src/auth/auth.controller.ts:11-49`
- bcrypt/conflict patterns: `apps/api/src/auth/auth.service.ts:25-46`
- Form pattern: `apps/web/lib/validation/round.ts`, `apps/web/components/ui/fields.tsx`,
  `apps/web/app/companies/[slug]/contribute/actions.ts:27-58`
- Authed mutation pattern: `apps/web/lib/contribute.ts:16-24`
- Company page top bar / facts panel: `apps/web/app/companies/[slug]/page.tsx:14-38`
- Prisma relation pattern: `packages/db/prisma/schema.prisma:114-139` (FundingRound)
- Prior plan in this style: `thoughts/shared/plans/2026-07-03-company-edit-proposals.md`
