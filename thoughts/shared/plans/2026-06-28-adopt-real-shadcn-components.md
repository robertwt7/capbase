# Adopt Real shadcn/ui Components — Implementation Plan

## Overview

Convert `apps/web`'s bespoke hand-written Tailwind primitives into **real shadcn/ui
components** (generated via the CLI, then re-themed to the monochrome "terminal ledger"
design system), making `components.json` meaningful so future UI can be built with
`npx shadcn add <name>`. The monochrome visual language, tokens, and Funding Ladder are
unchanged — this is a provenance/structure conversion, not a redesign.

## Current State Analysis

`apps/web/components/ui/` today:

- **Genuine shadcn source (Radix-based, already themed):** `form.tsx`, `label.tsx`,
  `separator.tsx`.
- **Bespoke Tailwind to convert:** `Button.tsx` (cva, monochrome, `href`→`next/link`),
  `Card.tsx` (panel div + `emphasis`), `Tag.tsx` (`pill`/`box` + `mono`), `input.tsx`,
  `textarea.tsx`, `select.tsx` (**native `<select>`**) — the last three share
  `control.ts` (`controlClass`).
- **Role components (no shadcn equivalent, keep bespoke):** `Eyebrow`, `Stat`,
  `SectionHeader`, `EmptyState`, `PageContainer`, plus `components/FundingLadder.tsx`.
- **Legacy wrapper:** `Field.tsx` exports `Field` **and** `FormError`. `Field` is used
  only by the auth/admin pages; **`FormError` is also used by the new RHF forms**
  (`CompanyForm`, `AddRoundForm`) as the form-level (non-field) error box — so `FormError`
  must survive; only `Field` is superseded.
- Barrel `index.ts` re-exports everything; generic RHF wrappers in `fields.tsx`
  (`TextField`/`TextareaField`/`SelectField`).

Key facts verified:

- **No new dependencies needed.** `package.json` already has `@radix-ui/react-select@^2.3.1`,
  `@radix-ui/react-slot@^1.3.0`, `@radix-ui/react-label`, `@radix-ui/react-separator`,
  `class-variance-authority`, `lucide-react`, `tw-animate-css`, `tailwind-merge`, `clsx`.
- `components.json` is correctly configured (new-york, `@/*`, `cssVariables: true`,
  `baseColor: neutral`) but the CLI was never run.
- `app/globals.css` already declares the **full shadcn semantic-token contract**
  (`--primary`, `--border`, `--input`, `--ring`, `--card`, `--destructive` = graphite, …)
  mapped onto the graphite ramp, exposed via `@theme inline`. `tw-animate-css` is imported
  and `@custom-variant dark` is declared so Radix/shadcn classes compile.
- **No tests** in `apps/web`. Verification is `check-types` + `lint` (`--max-warnings 0`,
  strict) + `make build` + manual.
- Network is available; `shadcn@4.12.0` resolves from the registry.
- `companyFormDefaults`: `primarySector: ''` (→ Radix placeholder), `status: 'Private'`,
  `stage: 'Seed'` (real defaults, render selected).

### Key Discoveries:

- `Button` has a project-specific API the shadcn default lacks: `variant`
  `primary`/`outline`/`ghost`, `shape` `pill`/`box`, `size` `sm`/`md`, `block`, and
  `href`→`next/link`. (`components/ui/Button.tsx:7-84`). Decision: **preserve this API**;
  rebuild it on the shadcn structure (cva + `data-slot` + `Slot`/`asChild`), do not adopt
  shadcn's default `default`/`destructive`/`secondary`/`lg`/`icon` contract.
- `Card` is consumed as a single panel with `emphasis` + `className` padding at 4 sites
  (`CompanyForm.tsx:52`, `AddRoundForm.tsx:52`, the three auth pages). Decision:
  **thin wrapper** — keep the `emphasis` prop on the shadcn `Card` root; do not force
  `CardHeader`/`CardContent` into call sites.
- `SelectField` currently spreads `{...field}` onto a native `<select>` and callers pass
  `<option>` children (`CompanyForm.tsx:138-171`). Radix Select needs `value` +
  `onValueChange` and `<SelectItem>` children → both the wrapper and `CompanyForm` change.
- `Tag` is consumed at 4 sites: `app/page.tsx:111`, `app/companies/[slug]/page.tsx:44,51`,
  `app/admin/page.tsx:68`, `app/(account)/profile/page.tsx:22,102` (last two pass
  `className`). All become `Badge` with the same `variant`/`mono` props.
- `form.tsx`, `label.tsx`, `separator.tsx` are already Radix-based and themed — **leave
  as-is** (they already satisfy "real shadcn"; regenerating `label.tsx` would re-introduce
  shadcn's `text-sm font-medium` default and lose the mono-uppercase meta treatment).
- Generated shadcn files are lowercase (`button.tsx`, `card.tsx`, `badge.tsx`). The old
  capitalised files (`Button.tsx`, `Card.tsx`, `Tag.tsx`) must be **deleted** to avoid
  two files for one component; the barrel re-exports the stable capitalised names.

## Desired End State

- `Button`, `Card`, `Badge`, `Input`, `Textarea`, `Select` are CLI-generated shadcn files,
  re-themed monochrome (mapped onto the existing CSS variables; no accent color, no red
  destructive, no shadcn default radii/rings that fight the graphite ramp).
- `Select` is shadcn's **Radix Select**, wired to react-hook-form via a `Controller` in
  `SelectField`; `CompanyForm` uses `<SelectItem>` + a `SelectValue` placeholder.
- `Tag` → `Badge`, keeping the `variant` (`pill`/`box`) + `mono` treatment via
  `badgeVariants`. `Tag.tsx` deleted; all 4 consumers updated.
- The auth/admin pages (`login`, `register`, `admin/login`) migrate off `Field` onto
  real shadcn `Label` + `Input` (keeping their existing manual-fetch submit and CSS-module
  page layout, and the `FormError` box). `Field` deleted.
- `control.ts` deleted (its surface language folded into the themed `input`/`textarea`/
  select trigger).
- The barrel keeps the **capitalised public API** (`Button`, `Card`, `Badge`, `Input`,
  `Textarea`, `Label`, `Separator`, `Form*`, plus Radix `Select*` parts) so consumer
  imports barely change.
- `components.json` is proven: `npx shadcn add <name>` drops a correctly-themed file.
- `CLAUDE.md` design-system/components section updated to describe real shadcn usage.

### Verification of end state

- `yarn workspace web check-types`, `yarn workspace web lint`, `make build` all pass.
- A scratch `npx shadcn@latest add <name>` produces a file using the project tokens
  (proves `components.json` is wired), then is discarded.
- Manual: landing, company profile, contribute, add-round, login, register, admin/login
  all render correctly and strictly monochrome; the Select dropdown works with validation.

## What We're NOT Doing

- **Not** changing the monochrome visual language, the graphite tokens in `globals.css`,
  the type roles, or the Funding Ladder.
- **Not** adding `Dialog` or `Table` (deferred — no consumer; the directory is a CSS-grid
  "table" and add-round is an inline expanding form, not a modal; the strict lint gate
  would flag unused primitives). `components.json` being wired means either can be added
  the moment a consumer needs it.
- **Not** touching the role components (`Eyebrow`, `Stat`, `SectionHeader`, `EmptyState`,
  `PageContainer`) or `FundingLadder` — shadcn has no equivalent.
- **Not** converting the auth/admin pages to RHF+zod or removing their CSS modules /
  back-compat token aliases (`--font-body`/`--page-max`/`--page-pad`). Their forms move to
  `Label`+`Input`+`FormError` only; the full page redesign stays a future ticket.
- **Not** regenerating `form.tsx`, `label.tsx`, `separator.tsx` (already genuine shadcn).
- **No** API / DTO / Prisma changes; **no** net-new pages or features.

## Implementation Approach

Work bottom-up: convert the leaf primitives first (Phase 1) so the tree stays compiling,
then the interactive Select that needs form-wiring changes (Phase 2), then the legacy-page
migration that lets us delete `Field` (Phase 3), then prove the pipeline and document
(Phase 4).

For each generated component: run the CLI to get the canonical shadcn structure, **review
the diff**, then apply the monochrome re-theme shown below. The CLI may try to edit
`globals.css`/tokens or add deps — **revert any change outside the new component file**
(our token contract and deps are already complete). Use the **`shadcn` skill** for CLI
mechanics. If the CLI cannot run for any reason, hand-author the files to match the canonical
shadcn structure shown below (this is acceptable since the end state is the themed source,
not the CLI invocation itself — but prefer running it so `components.json` is genuinely
exercised).

---

## Phase 1: Convert leaf primitives (Button, Card, Badge, Input, Textarea) + reconcile barrel

### Overview
Generate and re-theme the non-interactive primitives, delete the superseded bespoke files
+ `control.ts`, and update the barrel + `Tag`→`Badge` consumers. Select and `Field` are
untouched in this phase. At the end the app compiles and renders identically.

### Changes Required:

#### 1. Generate the shadcn primitives
Run (review each generated file, revert any non-component edits):
```bash
cd apps/web && npx shadcn@latest add button card badge input textarea --overwrite
```
This overwrites the lowercase `input.tsx`/`textarea.tsx` and creates `button.tsx`,
`card.tsx`, `badge.tsx`. The old capitalised `Button.tsx`/`Card.tsx`/`Tag.tsx` remain
until deleted below.

#### 2. Re-theme `components/ui/button.tsx` — preserve the project API
Rebuild on shadcn structure (`data-slot="button"`, `Slot`/`asChild`, cva) but keep our
variant contract and the `href`→`next/link` behavior. Map colors onto semantic tokens.
**File**: `components/ui/button.tsx`
```tsx
import Link from 'next/link';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans font-medium ' +
    'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
    'disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-graphite-900',
        outline: 'border border-primary text-primary hover:bg-primary hover:text-primary-foreground',
        ghost: 'text-primary hover:text-graphite-500',
      },
      shape: { pill: 'rounded-full', box: 'rounded-md' },
      size: { sm: 'h-9 text-sm', md: 'h-11 text-sm' },
      block: { true: 'w-full', false: '' },
    },
    compoundVariants: [
      { variant: 'ghost', class: 'h-auto px-0' },
      { variant: ['primary', 'outline'], size: 'sm', class: 'px-4' },
      { variant: ['primary', 'outline'], size: 'md', class: 'px-6' },
    ],
    defaultVariants: { variant: 'primary', shape: 'box', size: 'md', block: false },
  },
);
// ...same discriminated ButtonAsButton | ButtonAsLink prop types as the current Button.tsx,
// using VariantProps<typeof buttonVariants>; render <Link> when href is a string (with
// data-slot="button"), else <button type={type ?? 'button'} data-slot="button">.
export { buttonVariants };
```
Notes: `bg-ink`→`bg-primary`, `text-paper`→`text-primary-foreground`, focus outline
`outline-ink`→`outline-ring` (both = ink). Export `buttonVariants` (shadcn convention).
Keep the rest of the component body identical to current `Button.tsx:38-84`.

#### 3. Re-theme `components/ui/card.tsx` — thin wrapper with `emphasis`
Keep the shadcn `Card` root (with `data-slot`) but make it the single-panel API consumers
use. Re-export `CardHeader`/`CardContent`/etc. from the generated file too (available for
future use, no consumer churn).
**File**: `components/ui/card.tsx`
```tsx
// Card root re-themed:
function Card({
  className,
  emphasis = false,
  ...props
}: React.ComponentProps<'div'> & { emphasis?: boolean }) {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-lg border bg-surface',
        emphasis ? 'border-ink' : 'border-line',
        className,
      )}
      {...props}
    />
  );
}
// Keep shadcn's CardHeader/CardTitle/CardDescription/CardAction/CardContent/CardFooter
// (re-themed: drop default py/gap if they fight the panel; map text-card-foreground→text-ink).
```
Remove shadcn's default `py-6 shadow-sm gap-6` from the root so existing `className="p-9"`/
`p-5` padding controls spacing exactly as today.

#### 4. Re-theme `components/ui/badge.tsx` — replace `Tag`
Make `badgeVariants` mirror `Tag` exactly so `<Badge variant="pill" mono>` is a drop-in.
**File**: `components/ui/badge.tsx`
```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center border border-line text-graphite-700',
  {
    variants: {
      variant: {
        pill: 'rounded-full px-2.5 py-0.5',
        box: 'rounded-md px-2 py-0.5',
      },
      mono: {
        true: 'font-mono text-[11px] font-medium uppercase tracking-[0.08em]',
        false: 'font-sans text-xs',
      },
    },
    defaultVariants: { variant: 'box', mono: false },
  },
);

function Badge({
  className,
  variant,
  mono,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant, mono }), className)} {...props} />
  );
}
export { Badge, badgeVariants };
```
(`variant` here is `pill`/`box` to match `Tag`, intentionally diverging from shadcn's
default `default`/`secondary`/`outline` — this is the project's monochrome contract.)

#### 5. Re-theme `components/ui/input.tsx` + `textarea.tsx` — fold in `controlClass`
Inline the `control.ts` surface language (it's deleted in this phase). Keep `data-slot`.
**File**: `components/ui/input.tsx`
```tsx
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const controlClass =
  'flex w-full rounded-md border border-input bg-surface px-3 py-2.5 text-sm text-ink ' +
  'font-sans transition-colors outline-none placeholder:text-graphite-400 ' +
  'focus-visible:border-ink ' +
  'aria-[invalid=true]:border-ink aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-ink/15 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn(controlClass, className)} {...props} />;
}
```
**File**: `components/ui/textarea.tsx` — same `controlClass` + `'min-h-24 resize-y'`
(matching current `textarea.tsx:10`).
> Keep `controlClass` local to `input.tsx` and import it into `textarea.tsx` (and later the
> select trigger) **OR** duplicate the literal — pick whichever keeps lint happy; do **not**
> recreate a separate `control.ts` module (it's being deleted to satisfy the ticket). Simplest:
> `export const controlClass` from `input.tsx`, import in `textarea.tsx`.

#### 6. Delete superseded files
- `components/ui/Button.tsx`, `components/ui/Card.tsx`, `components/ui/Tag.tsx`,
  `components/ui/control.ts`.

#### 7. Update the barrel `components/ui/index.ts`
- `export { Button, buttonVariants } from './button';`
- `export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card';`
- `export { Badge, badgeVariants } from './badge';`
- `export { Input } from './input';` / `export { Textarea } from './textarea';`
- Remove the `Tag` export; keep `Eyebrow`/`Stat`/`SectionHeader`/`EmptyState`/
  `PageContainer`/`Separator`/`Label`/`Form*`/`fields` exports.
- Keep `export { Field, FormError } from './Field';` for now (Phase 3 removes `Field`).

#### 8. Update `Tag`→`Badge` consumers
- `app/page.tsx`: import `Badge` (drop `Tag`); `<Tag variant="pill">` → `<Badge variant="pill">`.
- `app/companies/[slug]/page.tsx`: import `Badge`; `<Tag variant="pill" mono>` →
  `<Badge variant="pill" mono>`, `<Tag variant="box">` → `<Badge variant="box">`.
- `app/admin/page.tsx`: import `Badge` (relative path); `<Tag variant="box" mono>` → `<Badge …>`.
- `app/(account)/profile/page.tsx`: import `Badge`; both `<Tag … className={…}>` → `<Badge … className={…}>`.

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `yarn workspace web check-types`
- [x] Lint passes (strict, 0 warnings): `yarn workspace web lint`
- [x] Build passes: `make build`
- [x] `rg -n "from './Tag'|components/ui/Tag|control'" apps/web` returns nothing
- [x] No file named `Button.tsx`/`Card.tsx`/`Tag.tsx`/`control.ts` under `components/ui/`

#### Manual Verification:
- [ ] Landing page: buttons (pill/outline/ghost), sector cards, directory `Badge` stage pills look identical
- [ ] Company profile: status `Badge` + industry `Badge`s, buttons, cards unchanged
- [ ] Contribute & add-round cards/buttons/inputs/textarea render and focus correctly, strictly monochrome

**Implementation Note**: After automated verification passes, pause for human confirmation
of the manual checks before Phase 2.

---

## Phase 2: Swap native `<select>` → Radix Select, wire into RHF

### Overview
Replace the native select with shadcn's Radix Select, update `SelectField` to drive it with
a `Controller`, and convert `CompanyForm`'s `<option>`s to `<SelectItem>`s with a
`SelectValue` placeholder.

### Changes Required:

#### 1. Generate + re-theme the Radix Select
```bash
cd apps/web && npx shadcn@latest add select --overwrite
```
This overwrites the native `select.tsx` with the Radix composition (`Select`, `SelectGroup`,
`SelectValue`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectLabel`,
`SelectSeparator`, `SelectScrollUp/DownButton`). Re-theme:
- `SelectTrigger`: apply the same surface language as inputs — `border-input bg-surface`,
  `text-ink`, `focus-visible:border-ink`, `aria-invalid` → `border-ink ring-2 ring-ink/15`,
  `rounded-md`, `px-3`, match input height. Use the lucide `ChevronDownIcon` (already a dep).
- `SelectContent`/`SelectItem`: `bg-popover` (=surface) `text-popover-foreground` (=ink),
  `border-line`, selected/▸highlight via `focus:bg-accent` (=graphite-200) — **no accent
  hue**, monochrome only. Keep the `tw-animate-css` enter/exit classes (import already present).
- Remove any default colored ring; `--ring` is already ink.

#### 2. Rewire `SelectField` with a `Controller`
**File**: `components/ui/fields.tsx`
```tsx
import { Select, SelectContent, SelectTrigger, SelectValue } from './select';

export function SelectField<T extends FieldValues>({
  control, name, label, description, placeholder, children, ...rest
}: BaseProps<T> & { placeholder?: string; children: ReactNode }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select value={field.value || undefined} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>{children}</SelectContent>
          </Select>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
```
Notes: `value={field.value || undefined}` so the empty-string `primarySector` default
shows the placeholder (Radix root accepts an unmatched value → placeholder; `<SelectItem>`
must never have `value=""`). `onValueChange={field.onChange}` feeds RHF; `field.onBlur`/`ref`
are not needed for the Radix root. `FormControl` (the `Slot`) wraps `SelectTrigger` so
`aria-invalid`/`aria-describedby`/`id` still flow from `useFormField`.

#### 3. Update `CompanyForm` select usages
**File**: `app/contribute/CompanyForm.tsx`
- Import `SelectItem` from `@/components/ui`.
- Primary sector: drop the `<option value="" disabled>` placeholder; pass
  `placeholder="Select a sector…"` to `SelectField`; map `SECTORS` → `<SelectItem value={s}>`.
- Status / Stage: map `COMPANY_STATUSES`/`STAGES` → `<SelectItem value={s}>` (defaults
  `'Private'`/`'Seed'` render selected).

#### 4. Barrel: export the Radix Select parts
**File**: `components/ui/index.ts`
```ts
export {
  Select, SelectGroup, SelectValue, SelectTrigger, SelectContent,
  SelectItem, SelectLabel, SelectSeparator,
} from './select';
```
(Replaces the old single `Select` native export.)

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `yarn workspace web check-types`
- [x] Lint passes: `yarn workspace web lint`
- [x] Build passes: `make build` (run at end of Phase 4)
- [x] `rg -n "<option" apps/web/app/contribute/CompanyForm.tsx` — only the unrelated HQ-cities `<datalist>` option remains; all three Selects converted

#### Manual Verification:
- [ ] Contribute form: each Select opens a monochrome dropdown, keyboard-navigable; choosing a value updates the field
- [ ] Submitting with no sector shows the "Pick a valid sector." validation message; `aria-invalid` ring appears on the trigger
- [ ] Status/Stage show `Private`/`Seed` preselected; submit succeeds and round-trips to the API payload
- [ ] No color anywhere in the dropdown (monochrome only)

**Implementation Note**: Pause for human confirmation of manual checks before Phase 3.

---

## Phase 3: Migrate auth/admin pages off `Field`, delete `Field`

### Overview
Move `login`, `register`, `admin/login` from the legacy `Field` wrapper to real shadcn
`Label` + `Input`, keeping their existing manual-`fetch` submit, `useState` error, CSS-module
page layout, and the `FormError` box. Then delete `Field.tsx`'s `Field` export.

### Changes Required:

#### 1. Replace each `<Field>` with `Label` + `Input`
Pattern (per field):
```tsx
<div className="grid gap-1.5">
  <Label htmlFor="email">Email</Label>
  <Input id="email" type="email" name="email" autoComplete="username" required />
</div>
```
- **File**: `app/(account)/login/LoginForm.tsx` — Email, Password fields; keep `Card`,
  `Button`, `FormError`, the `account.module.css` layout, and the `onSubmit` fetch.
- **File**: `app/(account)/register/RegisterForm.tsx` — Name, Email, Password fields.
- **File**: `app/admin/login/page.tsx` — Email, Password fields (keep admin module styling).
- Update imports: drop `Field`, add `Label`; keep `Button`, `Card`, `Input`, `FormError`.

#### 2. Delete `Field`, keep `FormError`
**File**: `components/ui/Field.tsx` — remove the `Field` function; **keep `FormError`**
(used by `CompanyForm`/`AddRoundForm`). Consider renaming the file to `FormError.tsx` for
clarity (optional; if renamed, update the barrel import path).
**File**: `components/ui/index.ts` — `export { FormError } from './Field';` (drop `Field`).

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `yarn workspace web check-types`
- [x] Lint passes: `yarn workspace web lint`
- [x] Build passes: `make build`
- [x] `rg -n "\bField\b" apps/web/app apps/web/components/ui/index.ts` shows no `Field` import/usage (only `FormField`/`TextField`/etc.)

#### Manual Verification:
- [ ] `/login`, `/register`, `/admin/login` render with mono-uppercase labels + monochrome inputs, layout unchanged
- [ ] Submitting bad credentials shows the `FormError` box; a successful login redirects
- [ ] Labels are associated with inputs (clicking a label focuses its input)

**Implementation Note**: Pause for human confirmation before Phase 4.

---

## Phase 4: Prove the pipeline + update docs

### Overview
Confirm `components.json` actually drives correctly-themed generation, and update project
docs to reflect real shadcn usage.

### Changes Required:

#### 1. Prove `components.json`
Run a throwaway add and inspect, then discard:
```bash
cd apps/web && npx shadcn@latest add tooltip   # inspect generated file uses @/* + tokens
git checkout -- . && git clean -fd components/ui  # discard the scratch file
```
(Choose any primitive not in scope; the point is to confirm the file lands under
`components/ui/` with `@/lib/utils` `cn` and the project tokens. Do not keep it.)

#### 2. Update `CLAUDE.md`
**File**: `CLAUDE.md` (Frontend → Components section)
- State that `Button`, `Card`, `Badge`, `Input`, `Textarea`, `Select`, `Label`,
  `Separator`, `Form` are **real shadcn components**, re-themed monochrome; lowercase
  filenames, capitalised exports via the barrel.
- Document `Tag` → `Badge` (`variant` `pill`/`box` + `mono`).
- Note `Select` is Radix, wired to RHF via `Controller` in `SelectField` (pass
  `<SelectItem>` children + a `placeholder`).
- Note `Field` removed; `FormError` is the form-level error box; auth/admin forms now use
  `Label`+`Input`.
- Note `Dialog`/`Table` are intentionally deferred but `npx shadcn add <name>` is wired.

### Success Criteria:

#### Automated Verification:
- [x] Final full pass: `yarn workspace web check-types && yarn workspace web lint && make build`
- [x] Scratch component fully removed: `git status` clean except intended changes

#### Manual Verification:
- [ ] The throwaway generated file used `@/lib/utils` `cn` + project tokens (no hardcoded hex, no `tailwind.config` reference)
- [ ] `CLAUDE.md` accurately describes the new component reality

---

## Testing Strategy

There is no automated test suite in `apps/web`; the gates are type-check, the **strict**
lint (`--max-warnings 0`), and the production build, backed by manual UI verification.

### Manual Testing Steps:
1. `make dev` (or `yarn dev`, port 3001) with the API running on `API_URL`.
2. Landing `/`: hero buttons, sector cards, directory rows + stage `Badge`s.
3. Company profile `/companies/[slug]`: status/industry `Badge`s, buttons, empty states.
4. Contribute `/contribute`: fill the form, exercise all three Selects (open/keyboard/select),
   trigger sector validation, submit successfully.
5. Company profile add-round: expand the inline form, submit, see the pending message.
6. `/login`, `/register`, `/admin/login`: labels/inputs, error box, successful submit.
7. Confirm strict monochrome throughout (no accent/red/gradient).

## Performance Considerations

Negligible. Radix Select adds a small client bundle but `@radix-ui/react-select` is already
a dependency; `tw-animate-css` is already imported. No SSR/ISR behavior changes.

## Migration Notes

- The CLI may attempt to edit `globals.css`/tokens or add deps — revert anything outside the
  new component file; the token contract and deps are already complete.
- Watch for case-collision artifacts: ensure the capitalised `Button.tsx`/`Card.tsx`/`Tag.tsx`
  are deleted so only the lowercase generated files remain.
- `FormError` is deliberately retained (form-level error box) even though it lived in the
  "legacy" `Field.tsx`.

## References

- Ticket: `thoughts/shared/tickets/2026-06-28-adopt-real-shadcn-components.md`
- Components: `apps/web/components/ui/` (`index.ts`, `fields.tsx`, `form.tsx`, `Button.tsx`,
  `Card.tsx`, `Tag.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `control.ts`, `Field.tsx`)
- Tokens/config: `apps/web/app/globals.css`, `apps/web/lib/utils.ts`, `apps/web/components.json`
- Forms: `apps/web/lib/validation/company.ts`, `apps/web/app/contribute/CompanyForm.tsx`,
  `apps/web/app/companies/[slug]/AddRoundForm.tsx`
- Tag consumers: `app/page.tsx`, `app/companies/[slug]/page.tsx`, `app/admin/page.tsx`,
  `app/(account)/profile/page.tsx`
- Auth/admin consumers: `app/(account)/login/LoginForm.tsx`,
  `app/(account)/register/RegisterForm.tsx`, `app/admin/login/page.tsx`
- shadcn skill (CLI mechanics): the `shadcn` skill
- Prior design-system work: `thoughts/shared/plans/2026-06-28-design-system-and-lint.md`
