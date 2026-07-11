# Forms Revamp: Red Errors, Auth RHF Migration, Resend Email, Unlock UX — Implementation Plan

## Overview

Four fixes from the ticket, in one pass over the auth/contribution surfaces:

1. Validation errors become **red** (a sanctioned design-system carve-out from the monochrome rule).
2. Register + login forms migrate to the **react-hook-form + zod** pattern, register gains a **confirm-password** field.
3. Registration sends a **welcome email via Resend** (dev-safe no-op when unconfigured).
4. The "Contribute to unlock" flow gets **copy/UX fixes** so users know *any* contribution unlocks all profiles — no backend change.

## Current State Analysis

- **Register form** (`apps/web/app/(account)/register/RegisterForm.tsx`) is a legacy manual form: `useState` + `FormData` + native HTML validation, no zod, no field-level errors, **no confirm-password**. Login (`apps/web/app/(account)/login/LoginForm.tsx`) is identical in shape. Both use legacy `account.module.css` (`.main`, `.card`, `.cardForm`, `.title`, `.sub`, `.altLine`, `.altLink`).
- **Errors are monochrome by design**: `FormError.tsx:10` uses `text-ink` on `bg-surface`/`border-line`; `FormMessage` (`components/ui/form.tsx:118`) is `text-ink font-semibold`; invalid inputs get `aria-[invalid=true]:border-ink … ring-ink/15` (`components/ui/input.tsx:12`); `globals.css:44` maps `--destructive: var(--graphite-900)`. The user can't distinguish errors from body copy. **Decision made: introduce red.**
- **No email code exists anywhere** in the repo — no Resend/nodemailer/SMTP, no mail deps in any `package.json`. Registration (`apps/api/src/auth/auth.service.ts:27-40`) creates the user and returns a JWT, nothing else.
- **Unlock gating is already global**: `companies.service.ts:97` unlocks if `lastContributionAt` (`apps/api/src/users/users.service.ts:104-125` — max `createdAt` across all 8 contributable tables, filtered only by `submittedById`, **no companyId filter, no moderationStatus filter**) is within 30 days (`CONTRIBUTION_WINDOW_DAYS`, `packages/api/src/domain/contributions.ts`). The bug is *perception*: the LockNote CTA (`apps/web/app/companies/[slug]/page.tsx:344-355`) links to `/companies/{slug}/contribute`, a page titled "Contribute to {Company}" (`contribute/page.tsx:67`), implying a per-company requirement that doesn't exist.

## Desired End State

- Field-level and form-level validation errors render in red across every form (auth, contribution, settings, admin login).
- `/register` and `/login` are RHF+zod forms styled with Tailwind utilities (no `account.module.css`), register has confirm-password with inline "Passwords do not match." feedback.
- Registering with `RESEND_API_KEY` set sends a welcome email; without it, the API logs a skip line and registration behaves identically.
- LockNote, the contribution hub, and the profile access panel all say that **any** contribution (including a brand-new company) unlocks all profiles for 30 days, with a visible path to `/contribute`.

### Key Discoveries

- `lib/validation/profile.ts:19-28` already has the exact confirm-password zod pattern (`.refine` with `path: ['confirmPassword']`) — reuse it for register.
- `SettingsForms.tsx:94-166` is the model RHF client form (zodResolver, `mode: 'onBlur'`, `TextField`, `FormError`, `form.formState.isSubmitting`).
- Auth must keep the **route-handler** submit (`app/api/auth/register/route.ts`, `app/api/auth/login/route.ts`) — they own setting the httpOnly `capbase_token` cookie. The RHF forms will `fetch` these routes, not call server actions. (Confirmed with user.)
- The register route handler already collapses class-validator `message[]` to one string and passes through the API's status (409 for duplicate email at `auth.service.ts:30`) — the client can map 409 onto the `email` field.
- Zod v4 idiom in this repo: `z.email('…')` (see `profile.ts:6`), not `z.string().email()`.
- `--color-destructive` is already exposed as a Tailwind utility (`globals.css:91`) — changing the `:root` value is enough for `text-destructive`, `border-destructive/30`, etc. to work.
- `account.module.css`'s auth classes (lines 1–50) are used **only** by the two auth forms; the profile page uses the separate `.profileMain`+ section (lines 52+). The auth block can be deleted; the file stays for profile.
- docker-compose `api` service env block is at `docker-compose.yml:31-36` — new env vars must be added there too.

## What We're NOT Doing

- **No change to unlock gating logic.** Stays global; PENDING contributions still count immediately. (User chose UX-fix-only.)
- **No email verification / password reset flow** — welcome email only. Verification links are a future ticket.
- **No red for destructive *actions*** — the dropdown-menu `destructive` variant (delete-style menu items) stays weight-based. The carve-out is validation/error feedback only.
- **Not migrating** the profile pages or `/admin` off their CSS modules.
- **Not converting auth submit to server actions** — route handlers stay.
- No new shared `@repo/api` types — `RegisterInput`/`LoginInput` already exist (`packages/api/src/domain/auth.ts:3-12`); `confirmPassword` is client-only and stripped by the mapper.

## Implementation Approach

Four phases, ordered so the visual foundation (red tokens) lands first and each phase is independently shippable. Phases 1–2 are `apps/web` only, Phase 3 is `apps/api` (+ compose), Phase 4 is copy-only in `apps/web`.

---

## Phase 1: Red Error Tokens

### Overview
Introduce a real red `--destructive` and apply it to the three error surfaces (form-level box, field message, invalid control). Update CLAUDE.md so the design system officially carves out validation errors.

### Changes Required

#### 1. Design tokens
**File**: `apps/web/app/globals.css`
**Changes**: Replace the monochrome destructive mapping (line 44) with a restrained signal red that doesn't fight the graphite ramp:

```css
  --destructive: #b42318; /* validation/error red — the one sanctioned hue (see CLAUDE.md) */
  --destructive-foreground: var(--paper);
```

Also update the file-header comment block (lines 4–10, "Strictly graphite … never hue") to note the single exception: validation errors use `--destructive` red.

#### 2. Form-level error box
**File**: `apps/web/components/ui/FormError.tsx`
**Changes**: Red-tinted box, plus `role="alert"` for a11y:

```tsx
export function FormError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 font-sans text-sm text-destructive',
        className,
      )}
    >
      {children}
    </p>
  );
}
```

#### 3. Field-level error message
**File**: `apps/web/components/ui/form.tsx`
**Changes**: `FormMessage` (line 118): `text-ink` → `text-destructive`:

```tsx
className={cn('font-sans text-[13px] font-semibold text-destructive', className)}
```

#### 4. Invalid control surface
**File**: `apps/web/components/ui/input.tsx`
**Changes**: `controlClass` (line 12), swap the invalid state to red (covers `Input`, `Textarea`, and the Select trigger, which all share `controlClass`):

```
'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/15 '
```

#### 5. Design-system docs
**File**: `CLAUDE.md`
**Changes**: In the "Design system" section, amend the bullet
`Never hardcode hex values. Destructive is monochrome too — emphasis is weight/border, never red.`
to state that **validation/error feedback is the one sanctioned use of red** (`--destructive` / `text-destructive`, `FormError`, `FormMessage`, invalid-control borders); destructive *actions* remain monochrome-weight; everything else stays graphite.

### Success Criteria

#### Automated Verification:
- [x] Lint passes: `make lint`
- [x] Build passes: `make build`
- [x] No remaining monochrome error styling: `grep -rn "text-ink" apps/web/components/ui/FormError.tsx apps/web/components/ui/form.tsx` returns no match on error-message lines, and `grep -n "invalid=true]:border-ink" apps/web/components/ui/input.tsx` returns nothing

#### Manual Verification:
- [ ] Submit an empty contribution form (`/companies/{slug}/contribute`) — field messages and invalid borders/rings render red
- [ ] Trigger a login failure — the `FormError` box renders as a red-tinted box
- [ ] Rest of the UI is unchanged (no red leaking into badges, buttons, dropdowns)

**Implementation Note**: Pause here for manual confirmation before Phase 2.

---

## Phase 2: Auth Forms → RHF + zod (with confirm-password)

### Overview
Rewrite `RegisterForm` and `LoginForm` on the RHF+zod pattern (modeled on `SettingsForms.tsx`), add confirm-password to register, replace `account.module.css` usage with Tailwind utilities, and delete the now-dead auth CSS block.

### Changes Required

#### 1. Auth validation schemas
**File**: `apps/web/lib/validation/auth.ts` (new)

```ts
import type { LoginInput, RegisterInput } from '@repo/api';
import { z } from 'zod';

export const registerFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.'),
    email: z.email('Enter a valid email address.'),
    password: z.string().min(8, 'Use at least 8 characters.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

export type RegisterFormValues = z.infer<typeof registerFormSchema>;

export const registerFormDefaults: RegisterFormValues = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
};

/** confirmPassword is client-only — never sent to the API. */
export function toRegisterInput(v: RegisterFormValues): RegisterInput {
  return { name: v.name, email: v.email, password: v.password };
}

export const loginFormSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;

export const loginFormDefaults: LoginFormValues = { email: '', password: '' };

export function toLoginInput(v: LoginFormValues): LoginInput {
  return { email: v.email, password: v.password };
}
```

#### 2. Register form rewrite
**File**: `apps/web/app/(account)/register/RegisterForm.tsx`
**Changes**: Full rewrite. Keeps the fetch to `/api/auth/register` (cookie-setting route handler, unchanged). Maps 409 onto the `email` field.

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button, Card, Form, FormError, TextField } from '@/components/ui';
import {
  registerFormDefaults,
  registerFormSchema,
  toRegisterInput,
  type RegisterFormValues,
} from '@/lib/validation/auth';

export function RegisterForm({ next }: { next?: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string>();
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: registerFormDefaults,
    mode: 'onBlur',
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toRegisterInput(values)),
    });
    if (res.ok) {
      router.replace(next || '/');
      router.refresh();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (res.status === 409) {
      form.setError('email', {
        type: 'server',
        message: data.message ?? 'Email already registered.',
      });
      return;
    }
    setFormError(data.message ?? 'Registration failed. Please try again.');
  });

  return (
    <main className="flex items-center justify-center px-5 py-20 sm:px-8">
      <Card className="w-full max-w-[380px]">
        <Form {...form}>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5 p-8">
            <h1 className="font-display text-[22px] font-bold text-ink">Create your account</h1>
            <p className="mb-2 font-sans text-[13px] text-graphite-500">
              Join the open company database and start contributing.
            </p>

            <TextField control={form.control} name="name" label="Name" autoComplete="name" />
            <TextField
              control={form.control}
              name="email"
              label="Email"
              type="email"
              autoComplete="username"
            />
            <TextField
              control={form.control}
              name="password"
              label="Password"
              type="password"
              autoComplete="new-password"
            />
            <TextField
              control={form.control}
              name="confirmPassword"
              label="Confirm password"
              type="password"
              autoComplete="new-password"
            />

            {formError ? <FormError>{formError}</FormError> : null}

            <Button variant="primary" block type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Creating…' : 'Create account'}
            </Button>

            <p className="mt-1 text-center font-sans text-[13px] text-graphite-500">
              Already have an account?{' '}
              <Link
                className="font-semibold text-ink underline"
                href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
              >
                Sign in
              </Link>
            </p>
          </form>
        </Form>
      </Card>
    </main>
  );
}
```

#### 3. Login form rewrite
**File**: `apps/web/app/(account)/login/LoginForm.tsx`
**Changes**: Same structure with `loginFormSchema`/`toLoginInput`, fields `email` (`autoComplete="username"`) + `password` (`autoComplete="current-password"`), heading "Sign in", sub-copy kept ("Contribute company and funding data to unlock full profiles."), failure → `setFormError(data.message ?? 'Invalid email or password.')` (the login route returns 401 with that message — no field mapping needed), footer link to `/register` preserving `next`.

#### 4. Dead CSS cleanup
**File**: `apps/web/app/(account)/account.module.css`
**Changes**: Delete the auth-only classes (lines 1–50: `.main`, `.card`, `.cardForm`, `.title`, `.sub`, `.altLine`, `.altLink`) and update the header comment to say the module now covers only the profile page.

#### 5. Docs
**File**: `CLAUDE.md`
**Changes**: Update the two references to legacy CSS Modules ("admin and `(account)` auth pages") → admin and the `(account)` **profile** pages; note auth forms now follow the RHF+zod pattern.

### Success Criteria

#### Automated Verification:
- [x] Lint passes: `make lint`
- [x] Build passes: `make build`
- [x] No auth-page CSS-module imports remain: `grep -rn "account.module.css" apps/web/app/\(account\)/register apps/web/app/\(account\)/login` returns nothing

#### Manual Verification:
- [ ] `/register`: blur an empty name/email → red inline field messages; mismatched passwords → "Passwords do not match." on the confirm field
- [ ] Registering with an existing email shows the error on the **email field** (409 mapping)
- [ ] Successful register lands on `/` (or `next`) signed in; login works the same; `next` round-trips through both forms' footer links
- [ ] Auth pages look visually equivalent to before (centered 380px card, same type roles)

**Implementation Note**: Pause here for manual confirmation before Phase 3.

---

## Phase 3: Resend Welcome Email

### Overview
Add a `MailModule` to `apps/api` using the `resend` SDK. `AuthService.register` fires a non-blocking welcome email. Without `RESEND_API_KEY`, the service logs and no-ops — local dev and CI need no setup.

### Changes Required

#### 1. Dependency
```bash
yarn workspace api add resend
```

#### 2. Mail service
**File**: `apps/api/src/mail/mail.service.ts` (new)

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = config.get<string>('MAIL_FROM', 'Capbase <onboarding@resend.dev>');
  }

  /** Welcome email on registration. Never throws — mail failure must not fail auth. */
  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    if (!this.resend) {
      this.logger.log(`RESEND_API_KEY not set — skipping welcome email to ${to}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.from,
        to,
        subject: 'Welcome to Capbase',
        text: [
          `Hi ${name},`,
          '',
          'Welcome to Capbase — the open, crowdsourced company and funding database.',
          'Contribute a company, round, or person to unlock full profiles for 30 days.',
          '',
          '— The Capbase team',
        ].join('\n'),
      });
      this.logger.log(`Welcome email sent to ${to}`);
    } catch (err) {
      this.logger.error(
        `Failed to send welcome email to ${to}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
```

**File**: `apps/api/src/mail/mail.module.ts` (new)

```ts
import { Module } from '@nestjs/common';

import { MailService } from './mail.service';

@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
```

#### 3. Wire into auth
**File**: `apps/api/src/auth/auth.module.ts`
**Changes**: Add `MailModule` to `imports`.

**File**: `apps/api/src/auth/auth.service.ts`
**Changes**: Inject `private readonly mail: MailService`; in `register()` after `this.users.create(...)` (line 33-38), before `buildResponse`:

```ts
void this.mail.sendWelcomeEmail(user.email, user.name); // fire-and-forget; never throws
```

#### 4. Tests
**File**: `apps/api/src/auth/auth.service.spec.ts`
**Changes**: The `AuthService` constructor gains a dependency — add a `MailService` mock provider (`{ sendWelcomeEmail: jest.fn().mockResolvedValue(undefined) }`) to the testing module; add an assertion that `sendWelcomeEmail` is called with the new user's email/name on successful register, and **not** called when register throws `ConflictException`.

#### 5. Config surface
**File**: `apps/api/.env.example`
**Changes**: Append:

```
# Email (Resend) — leave RESEND_API_KEY empty to disable sending (logged no-op)
RESEND_API_KEY=""
MAIL_FROM="Capbase <onboarding@resend.dev>"
```

**File**: `docker-compose.yml`
**Changes**: In the `api` service `environment` block (lines 31–36), add:

```yaml
      RESEND_API_KEY: ${RESEND_API_KEY:-}
      MAIL_FROM: ${MAIL_FROM:-Capbase <onboarding@resend.dev>}
```

**File**: `CLAUDE.md`
**Changes**: One line in the Backend section: registration sends a welcome email through `MailModule` (Resend; no-op when `RESEND_API_KEY` unset).

### Success Criteria

#### Automated Verification:
- [x] Unit tests pass: `make test` (including the updated `auth.service.spec.ts`)
- [x] Lint passes: `make lint`
- [x] Build passes: `make build`

#### Manual Verification:
- [ ] Register locally **without** `RESEND_API_KEY` → registration succeeds, API log shows the "skipping welcome email" line
- [ ] Register **with** a real `RESEND_API_KEY` (and a verified `MAIL_FROM` or the `onboarding@resend.dev` test sender) → welcome email arrives
- [ ] With an intentionally invalid API key → registration still succeeds; error is only logged

**Implementation Note**: Pause here for manual confirmation before Phase 4.

---

## Phase 4: Unlock UX Copy

### Overview
Make the global unlock rule legible: any contribution (including a new company) unlocks every profile for 30 days. Copy + a secondary path to `/contribute`; zero logic changes.

### Changes Required

#### 1. LockNote
**File**: `apps/web/app/companies/[slug]/page.tsx` (`LockNote`, lines 323–358)
**Changes**:
- Copy (lines 340–343) →
  `Showing {shown} of {total} — any contribution unlocks every profile for 30 days.`
- When `signedIn`, render a secondary ghost link next to the primary button:

```tsx
<span className="flex flex-wrap items-center gap-3">
  <Button variant="primary" shape="pill" size="sm" href={`/companies/${slug}/contribute`}>
    Contribute to unlock
  </Button>
  <Link
    href="/contribute"
    className="font-sans text-[13px] text-graphite-700 underline underline-offset-[3px] transition-colors hover:text-ink"
  >
    or add a new company
  </Link>
</span>
```

- Signed-out branch unchanged (`Sign in to unlock`). Add the `Link` import if not present.

#### 2. Contribution hub
**File**: `apps/web/app/companies/[slug]/contribute/page.tsx`
**Changes**: Extend the description `<p>` (lines 71–74):

```tsx
<p className="mt-2 text-sm text-graphite-500">
  Add what you know — every submission is reviewed by a moderator before it appears on the
  profile. Any contribution, here or elsewhere, unlocks full profiles for 30 days.{' '}
  <Link href="/contribute" className="text-ink underline underline-offset-[3px]">
    Add a new company instead
  </Link>
  .
</p>
```

#### 3. Profile access panel
**File**: `apps/web/app/(account)/profile/page.tsx` (`AccessPanel`, lines 96–106)
**Changes**: Locked copy →
`Contribute anything — a new company, a round, a person — to unlock all full profiles for the next 30 days.`

### Success Criteria

#### Automated Verification:
- [x] Lint passes: `make lint`
- [x] Build passes: `make build`

#### Manual Verification:
- [ ] Signed-in + locked on a company profile: LockNote shows the new copy, primary CTA still goes to the per-company hub, "or add a new company" goes to `/contribute`
- [ ] Contribution hub shows the clarifying sentence + working link
- [ ] Submitting a new company via `/contribute` then revisiting any company profile shows the full (unlocked) sections — confirming the copy now matches the actual behavior

---

## Testing Strategy

### Unit Tests
- `apps/api/src/auth/auth.service.spec.ts`: register sends welcome email; conflict path does not; login unaffected (mock `MailService`).
- No web unit-test infra exists — web phases are verified by lint/build + manual.

### Manual Testing Steps
1. `make dev`, then `/register`: blur-validate each field; mismatch passwords; duplicate email (409 → email field); successful register lands signed-in.
2. `/login`: wrong credentials → red FormError box; correct → signed in; `?next=` respected on both forms.
3. Trigger field errors on a contribution form to confirm the red treatment applies repo-wide.
4. Register without/with `RESEND_API_KEY` (see Phase 3 criteria).
5. Walk the locked→contribute→unlocked loop (Phase 4 criteria).

## Performance Considerations

- Welcome email is fire-and-forget (`void` + internal try/catch) — registration latency and reliability are unaffected by Resend.
- No query or rendering changes elsewhere.

## Migration Notes

- No DB changes.
- New optional env vars (`RESEND_API_KEY`, `MAIL_FROM`) default to disabled/no-op — existing deployments keep working with no action.
- `account.module.css` shrinks but remains (profile page); the back-compat token aliases in `globals.css` stay until the profile/admin redesign.

## References

- Original ticket: `thoughts/shared/tickets/2026-07-11-revamp-forms.md`
- RHF form model: `apps/web/app/(account)/profile/settings/SettingsForms.tsx`
- Confirm-password zod pattern: `apps/web/lib/validation/profile.ts:19-28`
- Gating logic (unchanged, for context): `apps/api/src/companies/companies.service.ts:75-110`, `apps/api/src/users/users.service.ts:104-125`
- Cookie-setting auth routes (unchanged): `apps/web/app/api/auth/register/route.ts`, `apps/web/app/api/auth/login/route.ts`
