# Design System Components + Workspace Lint Fix Implementation Plan

## Overview

Two related foundation tasks from `thoughts/shared/tickets/2026-06-25-design-system.md`:

1. **Design system** — Extract the "monochrome terminal ledger" language, currently
   duplicated inline across 6 CSS Modules, into a reusable component library at
   `apps/web/components/ui/`, then migrate every existing page onto it. Document the
   result in `CLAUDE.md`.
2. **Lint** — `next lint` is removed in Next 16 and the monorepo lint is partly broken
   and non-failing. Repair it, give every workspace a working flat config, and make
   `yarn lint` a real gate that catches pitfalls.

## Current State Analysis

### Design system
The design tokens are solid and centralized (`apps/web/app/globals.css:1` — graphite
ramp, font roles, layout vars). But the *components* built on those tokens are copy-pasted
inline in every route's `*.module.css`. Concrete duplication found:

- **Buttons** — the same "filled ink" + "ghost/text" + "outline pill" patterns are
  redefined as `.cta`/`.accountLink` (`SiteHeader.module.css`), `.submit`/`.primaryBtn`/
  `.ghostBtn`/`.ghostLink` (`account.module.css`, `contribute.module.css`),
  `.linkBtn`/`.decision`/`.approve`/`.reject`/`.submit` (`admin.module.css`),
  `.addToggle`/`.addSubmit`/`.addCancel`/`.lockAction`/`.emptyAction` (`profile.module.css`).
  6 files, ~15 button definitions.
- **Form fields** — `.field` + `.fieldLabel` + `.input`/`.textarea` + `.error` are
  byte-for-byte identical in `account.module.css`, `contribute.module.css`,
  `admin.module.css`, and re-spelled as `.addField`/`.addLabel`/`.addInput` in
  `profile.module.css`.
- **Tags/badges** — `.stageTag`/`.sectorTag` (`page.module.css`), `.roleTag`/`.itemType`/
  `.itemStatus` (`account.module.css`), `.typeTag` (`admin.module.css`),
  `.status`/`.tag` (`profile.module.css`) are two recurring shapes: rounded "pill" and
  boxed "mono-uppercase".
- **Cards/panels** — `.card`/`.access`/`.loginCard` (`account.module.css`, `admin.module.css`),
  `.success`/`.addForm` — all "surface + `--line` border + radius".
- **Section headers** — `.sectionHead`/`.sectionTitle`/`.sectionNote` (`page.module.css`)
  ≈ `.blockHead`/`.blockTitle`/`.blockNote` (`profile.module.css`).
- **Eyebrow** — `.eyebrow` (`page.module.css`), `.brandTag` (`admin.module.css`).
- **Stat/figure** — `.tapeItem`/`.tapeValue`/`.tapeLabel` (`page.module.css`),
  `.stat`/`.statValue`/`.statLabel` and `.diversityValue` (`profile.module.css`),
  `.sectorRaised` — all "mono figure + uppercase label".
- **Empty state** — `.empty`/`.emptyText`/`.emptyAction` and `.lockNote`/`.lockText`/
  `.lockAction` (`profile.module.css`) — dashed-border "invite contribution" panels.
- **Page container** — `max-width: var(--page-max); margin: 0 auto; padding … var(--page-pad)`
  repeated in every route.

`@repo/ui` exists but is **unused turborepo boilerplate** (`packages/ui/src/button.tsx`
is a `Button` that fires `alert()`); `grep` confirms `apps/web` imports nothing from it.

### Lint
- **`apps/web`** — `package.json:lint` = `next lint`. Running it errors:
  `Invalid project directory provided, no such directory: .../apps/web/lint`
  (Next 16 dropped `next lint`; `lint` is parsed as a positional dir arg). A flat config
  exists (`apps/web/eslint.config.mjs` → `@repo/eslint-config/next-js`) and works, **but**
  `eslint .` lints `.next/` → **15,852 warnings** vs ~3 real source warnings, because the
  shared base config only ignores `dist/**`, not `.next/**`.
- **`packages/api`** — `lint` script runs `eslint` but the package has **no `eslint`
  devDependency** → `command not found: eslint` → exit 127 → **root `yarn lint` fails**.
- **`only-warn` plugin** (`packages/eslint-config/base.js:1`) downgrades every rule to
  `warning`, so lint reports `0 errors` always and never fails — defeats "catch pitfalls".
- Real warnings today (the strict-mode fix list):
  - web: `turbo/no-undeclared-env-vars` for `NODE_ENV` ×3 (`app/api/**/route.ts`)
  - jobs: `turbo/no-undeclared-env-vars` for `PORT`, `INGEST_LIMIT` (`src/main.ts`, backfill)
  - api: `@typescript-eslint/no-unsafe-argument` ×10 in `test/*.e2e-spec.ts`
    (`request(app.getHttpServer())` — `getHttpServer()` returns `any`)
- **`packages/db`** — no `lint` script (Prisma + generated client; intentionally excluded).
- Shared configs present and mostly good: `base.js`, `next.js`, `nest.js`,
  `react-internal.js`, `library.js`, `prettier-base.js` with exports in
  `packages/eslint-config/package.json`.

## Desired End State

- A `apps/web/components/ui/` library of monochrome primitives, each a `.tsx` +
  co-located `.module.css`, exported via a barrel `index.ts`.
- All 6 existing route CSS Modules / pages migrated to consume the primitives; the
  duplicated button/field/tag/card/section/stat/empty-state rules deleted. Bespoke
  page-specific layout (grids, the Funding Ladder) stays per-page.
- `CLAUDE.md` "Design system" section documents the component library and usage rules.
- `yarn lint` (root, via turbo) runs in **every** workspace, lints only real source
  (no `.next`/`dist`/generated), and **exits non-zero on any problem** (warnings
  included). All currently-existing problems fixed → clean run.
- `yarn build` and `yarn check-types` still pass; the site renders identically (this is
  a refactor, no visual change intended).

### Key Discoveries:
- Tokens already centralized in `apps/web/app/globals.css:1` — components reference
  `var(--ink)` etc., so the library needs **no token sharing across packages** (the reason
  for choosing `apps/web/components/ui/` over `@repo/ui`).
- Radii (`6px`, `10px`, `12px`, `999px`) and a few spacings are hardcoded everywhere;
  introducing radius tokens in `globals.css` lets primitives stay token-pure per the
  CLAUDE.md "never hardcode" rule.
- Existing components `FundingLadder.tsx`, `SiteHeader.tsx`, `CompanyLogo.tsx` set the
  file convention: named export, co-located `.module.css`, relative imports.
- Server vs client: most consumers are server components; forms (`LoginForm.tsx`,
  `RegisterForm.tsx`, `CompanyForm.tsx`, `AddRoundForm.tsx`) are client. Primitives must
  be usable in both — keep them presentational (no hooks); a `Button` rendered as a link
  uses `next/link`, as a button is a plain `<button>` (no `'use client'` needed).

## What We're NOT Doing

- Not moving anything into `@repo/ui` or deleting its boilerplate (out of scope; it's
  unused but harmless — mention only).
- Not redesigning the visual language, adding color, or changing layout/spacing — pure
  extraction + dedup. Pixel output should be unchanged.
- Not extracting bespoke layout grids (company table, investor/people/deal grids, the
  Funding Ladder spine) into components — those stay page-local.
- Not adding a CSS framework, CSS-in-JS, or a Storybook (CLAUDE.md forbids the first;
  the others weren't asked for).
- Not adding lint to `packages/db` (Prisma/generated).
- Not adding new lint *rules* beyond the recommended sets already wired — just make the
  existing recommended config actually run and gate.

## Implementation Approach

Lint first (Phase 1) so every later phase is verified by a working, strict `yarn lint`.
Then build the library (Phase 2), migrate pages onto it (Phase 3), and document (Phase 4).
Phases 2→3 are where regressions can hide, so each migrated route is verified by
build + lint + manual visual check.

---

## Phase 1: Repair & harden the monorepo lint

### Overview
Make `yarn lint` run in every workspace, lint only real source, and fail on any problem.

### Changes Required:

#### 1. Web: replace `next lint`, ignore build output
**File**: `apps/web/package.json`
**Changes**: `"lint": "next lint"` → `"lint": "eslint . --max-warnings 0"`

**File**: `apps/web/eslint.config.mjs`
**Changes**: add a global ignores entry so `eslint .` skips Next build output and the
standalone server bundle:
```js
import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config} */
export default [
  ...nextJsConfig,
  { ignores: [".next/**", "next-env.d.ts", "server.js"] },
];
```

#### 2. Drop `only-warn` so severities are real
**File**: `packages/eslint-config/base.js`
**Changes**: remove the `eslint-plugin-only-warn` import and the `{ plugins: { onlyWarn } }`
block, and add `.next/**` to the shared `ignores` alongside `dist/**`. (Remove the
`eslint-plugin-only-warn` devDependency from `packages/eslint-config/package.json`.)
Recommended-set errors now fail; `--max-warnings 0` in each script makes warnings fail too.

#### 3. `packages/api`: give it a working lint
**File**: `packages/api/package.json`
**Changes**: add `eslint` (`^9`) + `typescript-eslint` toolchain via the shared config it
already references; change `"lint"` to `"eslint . --max-warnings 0"` (flat-config style,
matching the existing `eslint.config.mjs`). Add the `eslint` devDependency so the binary
resolves.

#### 4. Add `--max-warnings 0` to the remaining lint scripts
**Files**: `apps/api/package.json`, `apps/jobs/package.json`
**Changes**: `eslint "{src,...}/**/*.ts"` → `eslint "{src,...}/**/*.ts" --max-warnings 0`
(keep their globs; `packages/ui` already uses `--max-warnings 0`).

#### 5. Declare the env vars the turbo rule flags
**File**: `turbo.json`
**Changes**: add `"NODE_ENV"`, `"PORT"`, `"INGEST_LIMIT"` to `globalEnv`. This resolves the
web (×3) and jobs (×2) `turbo/no-undeclared-env-vars` warnings at the source (they are real
env vars the apps read).

#### 6. Fix the api e2e `no-unsafe-argument` warnings
**File**: `packages/eslint-config/nest.js`
**Changes**: add a test-file override turning off `@typescript-eslint/no-unsafe-argument`
(and it pairs) for `**/*.spec.ts`/`**/*.e2e-spec.ts`, since `request(app.getHttpServer())`
is the canonical Nest e2e pattern and `getHttpServer()` is typed `any` upstream:
```js
{
  files: ["**/*.spec.ts", "**/*.e2e-spec.ts"],
  rules: { "@typescript-eslint/no-unsafe-argument": "off" },
},
```
(Alternative considered: cast `app.getHttpServer() as Server` in each test — rejected as
noisier and repeated across files.)

### Success Criteria:

#### Automated Verification:
- [ ] Web lint runs on source only and passes: `yarn workspace web lint`
- [ ] `packages/api` lint resolves the binary and passes: `yarn workspace @repo/api lint`
- [ ] API lint passes: `yarn workspace api lint`
- [ ] Jobs lint passes: `yarn workspace jobs lint`
- [ ] UI lint passes: `yarn workspace @repo/ui lint`
- [ ] Root lint is green across all workspaces: `yarn lint`
- [ ] Lint actually fails on a planted error (sanity): add an unused var, confirm
      `yarn workspace web lint` exits non-zero, then revert
- [ ] Types still pass: `yarn workspace web check-types`

#### Manual Verification:
- [ ] Confirm no real source files were silenced by an over-broad ignore (spot-check that
      `apps/web/app/**` and `apps/web/components/**` are still linted)

**Implementation Note**: Removing `only-warn` may surface previously-masked recommended
*errors* anywhere in the repo. Run `yarn lint`, fix whatever surfaces (or, if a rule is
genuinely inappropriate, adjust it in the shared config with a one-line justification),
and only then proceed. Pause here for manual confirmation before Phase 2.

---

## Phase 2: Build the `apps/web/components/ui/` primitives

### Overview
Create the component library. Each primitive is presentational, token-pure, and matches
the existing file convention (named export + co-located `.module.css`).

### Changes Required:

#### 1. Radius tokens (so primitives stay token-pure)
**File**: `apps/web/app/globals.css`
**Changes**: add to `:root` (values taken from existing usage):
```css
--radius-sm: 6px;
--radius-md: 10px;
--radius-lg: 12px;
--radius-pill: 999px;
```

#### 2. Component files under `apps/web/components/ui/`
Each below is one `.tsx` + one `.module.css`, plus a barrel `index.ts`.

- **`Button.tsx`** — props: `variant: 'primary' | 'ghost' | 'outline'`,
  `shape?: 'pill' | 'box'` (default `box`), `size?: 'sm' | 'md'`, optional `href`
  (renders `next/link`) else `<button>` (passes `type`, `disabled`, form-action props).
  Replaces every button/CTA/link-button across the 6 modules.
- **`Field.tsx`** — exports `Field` (label + children wrapper), `Input`, `Textarea`,
  `FormError`. `Input`/`Textarea` forward all native props. Replaces `.field`/`.fieldLabel`/
  `.input`/`.textarea`/`.error` clusters.
- **`Tag.tsx`** — props: `variant: 'pill' | 'box'`. Replaces `.stageTag`, `.sectorTag`,
  `.roleTag`, `.itemType`, `.itemStatus`, `.typeTag`, `.status`, `.tag`.
- **`Card.tsx`** — surface + `--line` border + `--radius-md`; prop `emphasis?: boolean`
  (→ `border-color: var(--ink)`, covers `.access`/`.success`/`accessUnlocked`). Replaces
  `.card`, `.loginCard`, `.access`, `.success`, `.addForm`.
- **`SectionHeader.tsx`** — props: `title`, `note?`, optional `as` heading level.
  Replaces `.sectionHead`/`.sectionTitle`/`.sectionNote` and `.blockHead`/`.blockTitle`/
  `.blockNote`.
- **`Eyebrow.tsx`** — mono uppercase label. Replaces `.eyebrow`, `.brandTag`.
- **`Stat.tsx`** — props: `value`, `label`, `size?`. Replaces `.tapeItem`, `.stat`,
  `.diversityItem` figure, `.sectorRaised`.
- **`EmptyState.tsx`** — dashed-border panel: `text` + optional `action` (Button).
  Replaces `.empty`/`.emptyText`/`.emptyAction` and `.lockNote` family.
- **`PageContainer.tsx`** — `max-width: var(--page-max); margin: 0 auto; padding`.
  Replaces the repeated container rule.
- **`index.ts`** — barrel re-exporting all of the above.

**Style sourcing**: copy the exact declarations from the existing modules (e.g. Button
from `account.module.css:.submit`/`.primaryBtn` + `SiteHeader.module.css:.cta`) so output
is visually identical; only deduplicate and tokenize radii.

### Success Criteria:

#### Automated Verification:
- [ ] Type check passes: `yarn workspace web check-types`
- [ ] Lint passes on the new files: `yarn workspace web lint`
- [ ] App builds: `yarn workspace web build`

#### Manual Verification:
- [ ] Each primitive renders correctly in isolation (temporarily drop them on a scratch
      route or reuse one consuming page) and matches the look of the inline original
- [ ] No accent color / gradient introduced; still strictly monochrome

**Implementation Note**: Components exist but nothing consumes them yet — pages still use
inline CSS. Pause for manual confirmation before the migration.

---

## Phase 3: Migrate all pages onto the primitives

### Overview
Replace inline duplicated CSS with the primitives, route by route, deleting the now-dead
CSS rules. Verify each route builds, lints, and looks unchanged before moving on.

### Changes Required (one checklist item per consuming surface):

#### 1. `components/SiteHeader.tsx` + `.module.css`
Use `Button` for `.cta`/`.accountLink`. Keep header layout, search, brand mark local.

#### 2. `app/page.tsx` + `page.module.css`
`Eyebrow` for `.eyebrow`; `Stat` for the market tape; `SectionHeader` for section heads;
`Tag` for `.stageTag`/`.sectorTag`. Keep `.sectors` grid, `.table` grid, `.row` local.

#### 3. `app/(account)/account.module.css` consumers
`login/LoginForm.tsx`, `register/RegisterForm.tsx`, `profile/page.tsx`: `Card`, `Field`/
`Input`/`FormError`, `Button` (primary submit + ghost/alt links), `Tag` for `.roleTag`/
`.itemType`/`.itemStatus`, `Stat` where applicable. Delete the migrated rules from
`account.module.css`.

#### 4. `app/contribute/` (`page.tsx`, `CompanyForm.tsx`)
`Card`, `Field`/`Input`/`Textarea`/`FormError`, `Button`. Keep `.row` two-col grid local.
Delete migrated rules from `contribute.module.css`.

#### 5. `app/admin/` (`page.tsx`, `layout.tsx`, `login/page.tsx`)
`Button` for `.linkBtn`/`.decision`/`.approve`/`.reject`/`.submit`; `Card` for `.loginCard`;
`Field` cluster; `Tag` for `.typeTag`; `Eyebrow` for `.brandTag`; `EmptyState` for `.empty`.
Keep the queue `.table`/`.row` grid + tabs local. Delete migrated rules from
`admin.module.css`.

#### 6. `app/companies/[slug]/` (`page.tsx`, `AddRoundForm.tsx`)
`SectionHeader` for `.blockHead`; `Tag` for `.status`/`.tag`; `Stat` for `.statBand`/
`.diversity`; `EmptyState` for `.empty`/`.lockNote`; `Card` + `Field` + `Button` for the
inline add-round form. Keep investor/people/deal grids and the page header local.
Delete migrated rules from `profile.module.css`.

After each file: remove the CSS rules it no longer references (only the ones this change
orphaned — per surgical-changes rule).

### Success Criteria:

#### Automated Verification:
- [ ] Type check passes: `yarn workspace web check-types`
- [ ] Lint passes (no unused CSS-module import warnings, no unused vars): `yarn workspace web lint`
- [ ] App builds: `yarn workspace web build`
- [ ] No remaining duplicate button/field/tag definitions: `sg --lang css -p 'background: var(--ink)'`
      across `apps/web/app/**/*.module.css` returns only intentional non-button uses
      (spine/bar/mark), not buttons

#### Manual Verification:
- [ ] `yarn workspace web dev` — landing, company profile, contribute, login/register,
      profile, admin queue + admin login all render visually identical to before
- [ ] Forms still submit (login/register/contribute/add-round) and disabled/error states
      look correct
- [ ] Responsive breakpoints (header collapse, table reflow, form rows) still behave

**Implementation Note**: Migrate and verify one route group at a time; do not batch all six
before first build. Pause for manual visual confirmation before Phase 4.

---

## Phase 4: Document the design system in CLAUDE.md

### Overview
Update the project guide so future work uses the primitives instead of re-inlining CSS.

### Changes Required:

#### 1. `CLAUDE.md` — "Design system" subsection (apps/web)
**Changes**: add a "Components" paragraph under the existing design-system section listing
the `components/ui/` primitives and the rule: *build new UI from these primitives; only add
page-local CSS for bespoke layout (grids, the Funding Ladder). Never re-inline a button,
field, tag, card, section header, stat, or empty state.* Note the new radius tokens.

#### 2. `CLAUDE.md` — lint note
**Changes**: under deployment/tooling, note `yarn lint` runs flat-config ESLint per
workspace and **fails on any warning** (`--max-warnings 0`); `next lint` is gone (Next 16);
shared configs live in `@repo/eslint-config`.

### Success Criteria:

#### Automated Verification:
- [ ] Full repo still green: `yarn lint && yarn workspace web check-types && yarn workspace web build`

#### Manual Verification:
- [ ] CLAUDE.md accurately lists the shipped primitives and the lint behavior

---

## Testing Strategy

- **No new unit tests** — this is a visual refactor + tooling fix; the guard is the build,
  type-check, strict lint, and manual visual parity.
- **Regression guard**: before Phase 3, screenshot each route in `dev`; after migration,
  compare. Output should be pixel-identical.
- **Lint gate sanity**: plant-an-error test in Phase 1 proves the gate actually fails.

## Performance Considerations

None. CSS Modules compile the same; component extraction is build-time. No runtime cost.

## Migration Notes

- Pure refactor; no data/schema/runtime changes. Rollback = revert the branch.
- `@repo/ui` boilerplate is left as-is (unused). Flag for a future cleanup if desired.

## References

- Original ticket: `thoughts/shared/tickets/2026-06-25-design-system.md`
- Tokens: `apps/web/app/globals.css:1`
- Component convention: `apps/web/components/FundingLadder.tsx`, `apps/web/components/SiteHeader.tsx`
- Duplicated modules: `apps/web/app/page.module.css`, `app/(account)/account.module.css`,
  `app/contribute/contribute.module.css`, `app/admin/admin.module.css`,
  `app/companies/[slug]/profile.module.css`, `components/SiteHeader.module.css`
- Shared lint config: `packages/eslint-config/base.js`, `next.js`, `nest.js`
- `next lint` removal confirmed: `yarn workspace web lint` → "Invalid project directory … /lint"
