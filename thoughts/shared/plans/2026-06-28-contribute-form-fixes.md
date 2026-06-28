# Contribute Form Fixes Implementation Plan

## Overview

Fix four rough edges in the crowdsourced contribution forms (primarily the
"Add a company" form, with the funding-round form sharing the validation pattern):

1. Add a **Primary sector dropdown** (controlled `SECTORS` vocabulary) instead of
   relying only on the free-text Industries field.
2. Turn **Headquarters** into a city picker backed by a curated **`<datalist>`** of
   major global startup-hub cities (free entry still allowed).
3. **Swap the fonts** to a calmer pairing (Inter for UI/display, keep IBM Plex Mono
   for numerals) as a temporary legibility fix ahead of the full design-system ticket.
4. Replace the single generic error with **per-field inline validation** plus a
   bottom-of-form summary.

This is an interim correctness/UX pass. A separate, later ticket will redo the whole
design system — so font and visual changes here are deliberately minimal and reversible.

## Current State Analysis

- **Add-company form** — `apps/web/app/contribute/CompanyForm.tsx`. Client component
  using `useActionState(createCompanyAction)`.
  - Industries: free-text comma `Input` (`CompanyForm.tsx:82-84`).
  - Headquarters: free-text `Input` (`CompanyForm.tsx:65-67`).
  - Error: a single `state.error` rendered once via `<FormError>` just above the
    submit button (`CompanyForm.tsx:111`).
- **Server action** — `apps/web/app/contribute/actions.ts`. Returns
  `{ error?: string; success?: boolean }`. Validation produces **one** generic message
  (`actions.ts:39-49`) and never reports which field failed. It maps to
  `CreateCompanyInput` and does **not** currently send `primarySector` (`actions.ts:51-64`).
- **Funding-round form** — `apps/web/app/companies/[slug]/AddRoundForm.tsx` + its
  `addRoundAction`. Same single-error pattern.
- **UI primitives** — `apps/web/components/ui/Field.tsx` (+ `Field.module.css`).
  `Field` is a `<label>` wrapping a label span + control children. `Input`/`Textarea`/
  `Select` forward native props. `FormError` is a bordered `--ink` text box. There is
  **no per-field error slot** today.
- **Fonts** — `apps/web/app/layout.tsx:1-23` loads Archivo + IBM Plex Sans + IBM Plex
  Mono via `next/font/google`, exposing `--font-archivo` / `--font-plex-sans` /
  `--font-plex-mono`. `apps/web/app/globals.css:15-17` maps these to the role tokens
  `--font-display` / `--font-body` / `--font-mono`.
- **`primarySector` is already supported end-to-end** (verified):
  - `CreateCompanyInput.primarySector?: Sector | null` — `packages/api/src/domain/inputs.ts:37`
  - DTO `@IsOptional() @IsIn([...SECTORS])` — `apps/api/src/companies/dto/create-company.dto.ts:122-124`
  - Service persists it — `apps/api/src/companies/companies.service.ts:130`
  - Mapper returns it — `apps/api/src/companies/company.mapper.ts:115`
  - `SECTORS` vocab — `packages/api/src/domain/company.ts:42-48`
  
  So **no API/DB change is required** for the sector dropdown; the web form simply
  needs to send the field.

### Key Discoveries:
- The whole `primarySector` chain exists but the web form never populated it — this is
  purely a frontend gap.
- The design is strictly **monochrome** (CLAUDE.md): validation emphasis must come from
  weight/border/size, **not** a red error color.
- `Field` is the single shared label+control wrapper used by every form, so adding an
  `error` slot there fixes all forms consistently.
- Workspace name is `web`; verification commands use `yarn workspace web <script>` or
  `make lint` / `make build`.

## Desired End State

- The add-company form shows a **Primary sector** `<select>` (the 5 `SECTORS`), sent as
  `primarySector` and visible on the resulting company profile after approval.
- Headquarters is an `<input>` bound to a `<datalist>` of curated global cities — typing
  shows suggestions, but custom values are still accepted.
- The app renders in the new font pairing (Inter + IBM Plex Mono); no Archivo.
- Submitting an invalid form shows a clear message **under each offending field** and a
  short summary block at the bottom. Valid submissions still succeed.

## What We're NOT Doing

- **Not** redoing the design system, color ramp, spacing, or component visual language
  (separate later ticket). Font swap is the only typography change.
- **Not** converting Industries to a multi-select or removing the free-text tags field —
  per decision, Industries stays free-text tags; we *add* a Primary sector dropdown.
- **Not** adding a heavyweight world-cities npm dependency — curated datalist only.
- **Not** changing the API, DTOs, Prisma schema, or migrations.
- **Not** reworking the login/register auth forms' validation (they surface a single
  server auth error by design); they only inherit the new `Field` error slot passively.
- **Not** updating CLAUDE.md's design-system section — the font swap is a documented
  temporary deviation, to be reconciled in the design-system ticket.

## Implementation Approach

Four mostly-independent changes. Do the shared primitive change (Phase 4 `Field` error
slot) before wiring per-field errors into the forms. Cities and fonts are standalone.

---

## Phase 1: Primary sector dropdown

### Overview
Add a controlled `SECTORS` select to the add-company form and send `primarySector`.

### Changes Required:

#### 1. Add the select to the form
**File**: `apps/web/app/contribute/CompanyForm.tsx`
**Changes**: Import `SECTORS`. Add a `Primary sector` `Select` (place it in the existing
Status/Stage row group or its own row, above the free-text Industries field). Keep the
Industries free-text `Input` as-is.

```tsx
import { COMPANY_STATUSES, SECTORS, STAGES } from '@repo/api';
// ...
<Field label="Primary sector">
  <Select name="primarySector" defaultValue="" required>
    <option value="" disabled>
      Select a sector…
    </option>
    {SECTORS.map((s) => (
      <option key={s} value={s}>
        {s}
      </option>
    ))}
  </Select>
</Field>
```

#### 2. Read + validate + send it
**File**: `apps/web/app/contribute/actions.ts`
**Changes**: Read `primarySector`, validate it is in `SECTORS`, include it in the
`CreateCompanyInput`.

```ts
import { COMPANY_STATUSES, SECTORS, STAGES, type Sector, /* ... */ } from '@repo/api';
// ...
const primarySector = str('primarySector') as Sector;
// in validation: if (!SECTORS.includes(primarySector)) -> field error 'Pick a valid sector.'
// in input object: primarySector,
```

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `yarn workspace web check-types`
- [x] Lint passes: `yarn workspace web lint`
- [x] Build passes: `make build`

#### Manual Verification:
- [ ] The form shows a Primary sector dropdown with exactly the 5 sectors.
- [ ] Submitting selects a sector; after admin approval the profile shows that sector.
- [ ] Leaving it on the placeholder shows the inline "Pick a valid sector" error.

---

## Phase 2: Headquarters city datalist

### Overview
Provide autocomplete city suggestions while keeping `hq` a free-form string.

### Changes Required:

#### 1. Curated cities list
**File**: `apps/web/lib/cities.ts` (new)
**Changes**: Export a `readonly string[]` of ~150 major global startup-hub cities in
`"City, Region/Country"` form, consistent with the existing `"San Francisco, CA"`
placeholder. Representative starting set (expand to ~150):

```ts
export const CITIES: readonly string[] = [
  'San Francisco, CA', 'New York, NY', 'Boston, MA', 'Los Angeles, CA',
  'Seattle, WA', 'Austin, TX', 'Chicago, IL', 'Denver, CO', 'Miami, FL',
  'Toronto, Canada', 'Vancouver, Canada', 'London, UK', 'Berlin, Germany',
  'Paris, France', 'Amsterdam, Netherlands', 'Stockholm, Sweden',
  'Dublin, Ireland', 'Madrid, Spain', 'Barcelona, Spain', 'Lisbon, Portugal',
  'Zurich, Switzerland', 'Tel Aviv, Israel', 'Bangalore, India',
  'Mumbai, India', 'Singapore', 'Tokyo, Japan', 'Seoul, South Korea',
  'Sydney, Australia', 'São Paulo, Brazil', 'Mexico City, Mexico',
  // …expand to ~150 covering major hubs across all continents
];
```

#### 2. Wire the datalist into the form
**File**: `apps/web/app/contribute/CompanyForm.tsx`
**Changes**: Import `CITIES`; give the HQ `Input` a `list` attribute and render a
`<datalist>` with matching `id`.

```tsx
import { CITIES } from '../../lib/cities';
// ...
<Field label="Headquarters">
  <Input name="hq" list="hq-cities" placeholder="San Francisco, CA" required />
</Field>
<datalist id="hq-cities">
  {CITIES.map((c) => (
    <option key={c} value={c} />
  ))}
</datalist>
```

(`Input` forwards native props, so `list` passes through with no primitive change.)

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `yarn workspace web check-types`
- [x] Lint passes: `yarn workspace web lint`

#### Manual Verification:
- [ ] Typing in Headquarters shows matching city suggestions.
- [ ] A custom (non-listed) city can still be typed and submitted.

---

## Phase 3: Font swap (temporary)

### Overview
Replace Archivo + IBM Plex Sans with **Inter** for body and display; keep IBM Plex Mono
for numerals. Stopgap legibility fix only.

### Changes Required:

#### 1. Load Inter, drop Archivo + Plex Sans
**File**: `apps/web/app/layout.tsx`
**Changes**: Replace the `Archivo` and `IBM_Plex_Sans` imports with `Inter`; keep
`IBM_Plex_Mono`. Expose `--font-inter`. Update the `<body>` className list.

```tsx
import { IBM_Plex_Mono, Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
});
// <body className={`${inter.variable} ${plexMono.variable}`}>
```

#### 2. Repoint the role tokens
**File**: `apps/web/app/globals.css`
**Changes**: Update the type-role vars to use Inter for display + body, keep mono.

```css
--font-display: var(--font-inter), 'Inter', sans-serif;
--font-body: var(--font-inter), 'Inter', sans-serif;
--font-mono: var(--font-plex-mono), 'IBM Plex Mono', monospace;
```

> Note: This deliberately deviates from the Archivo/IBM Plex pairing documented in
> CLAUDE.md. Leave CLAUDE.md unchanged; the design-system ticket will reconcile.

### Success Criteria:

#### Automated Verification:
- [x] Build passes (fonts fetch at build): `make build`
- [x] Lint passes: `yarn workspace web lint`
- [x] No remaining references to the old font vars: `grep -rn "font-archivo\|font-plex-sans\|Archivo\|IBM_Plex_Sans" apps/web/app` returns nothing.

#### Manual Verification:
- [ ] Headlines, body, and labels render in Inter; numerals still mono.
- [ ] Pages look cleaner / no longer "weird"; no fallback-serif flash.

---

## Phase 4: Per-field inline validation

### Overview
Add an error slot to the shared `Field` primitive, change the contribute actions to
return field-keyed errors plus a summary, and render them in both contribute forms.

### Changes Required:

#### 1. Add an `error` slot to `Field` (+ control invalid state)
**File**: `apps/web/components/ui/Field.tsx`
**Changes**: Accept optional `error?: string`; render it beneath the control when set.

```tsx
export function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cx(styles.field, className)}>
      <span className={styles.label}>{label}</span>
      {children}
      {error ? <span className={styles.fieldError}>{error}</span> : null}
    </label>
  );
}
```

**File**: `apps/web/components/ui/Field.module.css`
**Changes**: Add a monochrome `.fieldError` rule (small, `--graphite-700`/`--ink`, no
red), and an `aria-invalid` border emphasis on `.control`.

```css
.fieldError {
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
}
.control[aria-invalid='true'] {
  border-color: var(--ink);
}
```

#### 2. Field-keyed action state
**File**: `apps/web/app/contribute/actions.ts`
**Changes**: Change the state shape and build per-field errors. Keep a `formError`
summary for the bottom of the form.

```ts
export type CompanyFormState = {
  errors?: Partial<Record<
    'name' | 'domain' | 'oneLiner' | 'description' | 'hq' | 'founded' |
    'headcount' | 'totalRaisedUsd' | 'industry' | 'status' | 'stage' |
    'primarySector' | 'lastValuationUsd', string
  >>;
  formError?: string;
  success?: boolean;
};
```

Validate each field individually, accumulating into `errors`. If `errors` is non-empty,
return `{ errors, formError: 'Please fix the highlighted fields.' }`. Keep the existing
`catch` returning `{ formError: 'Submission failed…' }`.

#### 3. Render per-field errors in the add-company form
**File**: `apps/web/app/contribute/CompanyForm.tsx`
**Changes**: Pass `error={state.errors?.<field>}` to each `Field`, and
`aria-invalid={!!state.errors?.<field>}` to each control. Replace the single
`state.error` near the submit button with `state.formError` summary (still via
`<FormError>`), kept at the bottom.

```tsx
<Field label="Company name" error={state.errors?.name}>
  <Input name="name" aria-invalid={!!state.errors?.name} required />
</Field>
{/* …repeat per field… */}
{state.formError ? <FormError>{state.formError}</FormError> : null}
```

#### 4. Same pattern for the funding-round form
**Files**: `apps/web/app/companies/[slug]/actions.ts` (the `addRoundAction` +
`RoundFormState`) and `apps/web/app/companies/[slug]/AddRoundForm.tsx`.
**Changes**: Mirror the field-keyed `errors` + `formError` shape and pass
`error` / `aria-invalid` per field; keep `formError` at the bottom.

### Success Criteria:

#### Automated Verification:
- [x] Type check passes: `yarn workspace web check-types`
- [x] Lint passes: `yarn workspace web lint`
- [x] Build passes: `make build`
- [ ] Existing API unit tests still pass (no API change expected): `make test`

#### Manual Verification:
- [ ] Submitting an empty add-company form shows an error **under each** required field
      plus the bottom summary.
- [ ] Fixing one field clears its message on resubmit while others remain.
- [ ] Invalid sector / non-integer numbers show the correct field's message.
- [ ] The funding-round form shows per-field errors the same way.
- [ ] Error styling stays monochrome (no red).

**Implementation Note**: After each phase's automated checks pass, pause for manual
confirmation before moving to the next phase.

---

## Testing Strategy

### Manual Testing Steps:
1. Sign in, open `/contribute`, submit empty → verify per-field + summary errors.
2. Fill valid data, pick a sector, type a custom HQ city → submit → success panel.
3. Approve via `/admin`, open the company profile → sector + HQ render correctly.
4. On a company profile, open "Add a funding round", submit empty → per-field errors.
5. Visually confirm Inter renders across landing, profile, contribute, admin.

### Automated:
- `yarn workspace web check-types`, `yarn workspace web lint`, `make build`, `make test`.

## Performance Considerations

- The curated `CITIES` array (~150 short strings) is negligible bundle weight.
- `next/font/google` self-hosts Inter at build (no extra runtime request).

## Migration Notes

None — no schema, DTO, or data changes. `primarySector` already exists; previously
submitted companies simply keep `primarySector = null`.

## References

- Add-company form: `apps/web/app/contribute/CompanyForm.tsx`
- Add-company action: `apps/web/app/contribute/actions.ts`
- Funding-round form: `apps/web/app/companies/[slug]/AddRoundForm.tsx`
- Shared field primitive: `apps/web/components/ui/Field.tsx` / `Field.module.css`
- Fonts: `apps/web/app/layout.tsx`, `apps/web/app/globals.css`
- Sector vocab + input/DTO support: `packages/api/src/domain/company.ts:42`,
  `packages/api/src/domain/inputs.ts:37`,
  `apps/api/src/companies/dto/create-company.dto.ts:122`
