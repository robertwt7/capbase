# Adopt Real shadcn/ui Components

## Summary

The current design-system redesign brought in Tailwind v4 + the shadcn **conventions**
(`cn`, `cva`, `data-slot`, `components.json`, `@/*` alias) and a few genuine shadcn
source files, but most visible primitives are bespoke hand-written Tailwind components
rather than actual shadcn components. This ticket converts them to real shadcn primitives
(generated via the CLI) themed to the monochrome design system, so future UI can be built
and extended with `npx shadcn add <name>` consistently.

## Background / Why

- `components.json` is currently **vestigial** — it only configures the shadcn CLI, which
  was never run. The components were authored by hand.
- "Customise based on shadcn components" was the original intent; instead only
  `form.tsx`, `label.tsx`, `separator.tsx` are genuine shadcn source. The rest
  (`Button`, `Card`, `input`, `textarea`, `select`, `Tag`) are custom Tailwind that
  merely follow shadcn style.
- `Select` is a **native `<select>`** (chosen so it registers with react-hook-form
  without a `Controller`), not shadcn's Radix Select.

## Current State

`apps/web/components/ui/`:
- **Genuine shadcn source:** `form.tsx`, `label.tsx`, `separator.tsx`
- **Bespoke Tailwind (to convert):** `Button.tsx`, `Card.tsx`, `Tag.tsx`, `input.tsx`,
  `textarea.tsx`, `select.tsx`, plus role components `Eyebrow`, `Stat`, `SectionHeader`,
  `EmptyState`, `PageContainer` (these have no shadcn equivalent — keep bespoke)
- **Legacy wrapper:** `Field.tsx` (`Field` + `FormError`) — still used by deferred
  admin/auth pages
- Tooling already in place: Tailwind v4 `@theme` tokens + full shadcn semantic-token
  contract in `app/globals.css`, `lib/utils.ts` `cn`, `components.json` (new-york,
  `@/*`, base-color neutral)
- Generic RHF field wrappers in `components/ui/fields.tsx`
  (`TextField`/`TextareaField`/`SelectField`)

## Desired End State

- `Button`, `Input`, `Textarea`, `Select`, `Card`, `Badge`, `Label`, `Separator`,
  `Form`, `Table`, `Dialog` are **real shadcn components** (CLI-generated), themed
  monochrome via the existing CSS variables — no accent color, no red destructive.
- `Select` is shadcn's **Radix Select**, wired into react-hook-form with a `Controller`
  (update `SelectField` in `fields.tsx` accordingly).
- `Tag` → shadcn **`Badge`** (keep the `mono` mono-uppercase variant via `badgeVariants`).
- The custom role components (`Eyebrow`, `Stat`, `SectionHeader`, `EmptyState`,
  `PageContainer`, `FundingLadder`) stay bespoke — shadcn has no equivalent.
- `components.json` becomes meaningful: `npx shadcn add <name>` drops correctly-themed
  files going forward.
- All pages/forms (landing, profile, contribute, add-round) rewired to the real
  primitives. Deferred admin/auth pages keep working (legacy `Field`/`FormError` or
  migrate as part of this — see Open Questions).

## Scope / Tasks

1. Run `npx shadcn@latest add button input textarea select label card badge separator
   table dialog` (review each generated file).
2. Re-theme generated components to monochrome (remove default radii/colors that fight
   the graphite ramp; map onto `--primary`/`--border`/`--ring`/etc. already defined).
3. Reconcile name collisions with the existing barrel (`index.ts`) — decide capitalised
   vs lowercase exports; keep the public API stable where pages already import.
4. Swap native `<select>` → Radix `Select`; update `SelectField` to use a `Controller`.
5. Convert `Tag` usages → `Badge`.
6. Rewire pages/forms; delete the superseded bespoke primitives + `control.ts`.
7. Update `CLAUDE.md` design-system/components section to reflect real shadcn usage.

## Out of Scope

- Changing the monochrome visual language, tokens, or the Funding Ladder.
- API / DTO / Prisma changes.
- Net-new pages or features.

## Open Questions

- **Deferred admin/auth pages:** migrate them to the real primitives in this ticket too,
  or keep the legacy `Field`/`FormError` wrappers until their own redesign?
- **Dialog/Table:** add now (used by the inline add-round flow / directory) or defer
  until a consumer actually needs them, to avoid unused primitives?
- **Barrel naming:** standardise on shadcn's lowercase filenames/exports, or preserve the
  current capitalised `Button`/`Card`/`Tag` public API to minimise churn in consumers?

## Verification

- `yarn workspace web check-types`, `yarn workspace web lint`, `make build` all pass.
- `npx shadcn add <name>` produces a correctly-themed component (proves `components.json`
  is wired).
- Manual: landing, company profile, contribute, and add-round render correctly; the
  Select dropdown works in the forms with validation; styling stays strictly monochrome.

## References

- Components: `apps/web/components/ui/` (`index.ts` barrel, `fields.tsx`, `form.tsx`)
- Tokens: `apps/web/app/globals.css`, `apps/web/lib/utils.ts`, `apps/web/components.json`
- Forms: `apps/web/lib/validation/`, `apps/web/app/contribute/CompanyForm.tsx`,
  `apps/web/app/companies/[slug]/AddRoundForm.tsx`
- Prior design-system work: this redesign (Tailwind v4 + shadcn conventions adoption)
