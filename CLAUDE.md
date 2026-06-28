This is a monorepo using TurboRepoJS, all using Typescript. It is an open-source
alternative to Crunchbase and Pitchbook: crowdsourced company + funding data with
admin moderation, plus automated ingestion of public filings.

Workspaces:

- `apps/web` — Next.js 16 frontend (public site + `/admin` moderation portal).
- `apps/api` — NestJS REST API (auth, moderation, public reads).
- `apps/jobs` — NestJS worker that ingests SEC EDGAR Form D filings on a cron.
- `packages/api` (`@repo/api`) — shared domain types consumed by every app.
- `packages/db` (`@repo/db`) — shared Prisma schema, migrations, seed, client.
- `packages/{ui,eslint-config,jest-config,typescript-config}` — shared tooling.

Postgres runs via the root `docker-compose.yml`. See the `Makefile` for the common
dev/prod commands (`make help`).

## Frontend (apps/web)

Next.js 16 (App Router, React 19). Styling is **Tailwind CSS v4 + shadcn/ui**, themed
to a monochrome design system. Tokens are declared in `app/globals.css` (`:root` for
the raw values, `@theme inline` to expose them as utilities); `lib/utils.ts` exports
`cn` (clsx + tailwind-merge). Style with Tailwind utilities and the `components/ui`
primitives — don't add CSS Module files for new UI. (Two legacy CSS Modules remain for
the not-yet-redesigned `admin` and `(account)` auth pages; back-compat token aliases
`--font-body`/`--page-max`/`--page-pad` exist only for them and will go when those
routes are redesigned.)

### Design system — "monochrome terminal ledger"

The interface is deliberately monochrome (graphite ramp) so that company logos are
the only color on screen. When adding UI, hold this line: no accent colors, no
gradients. Emphasis comes from weight, size, and the mono numerals — not hue.

- The graphite ramp is exposed as Tailwind colors via `@theme`: use `text-ink`,
  `bg-paper`, `bg-surface`, `text-graphite-{200..900}`, `border-line`, plus the shadcn
  semantic colors (`bg-primary`, `text-muted-foreground`, `border-border`, …) which all
  map onto the ramp. Never hardcode hex values. Destructive is monochrome too —
  emphasis is weight/border, never red.
- Type roles (next/font in `app/layout.tsx`, exposed as `@theme` font utilities):
  - `font-display` → Archivo. Headlines, company names, big figures.
  - `font-sans` (default `body`) → IBM Plex Sans. Body text.
  - `font-mono` → IBM Plex Mono. Every financial figure / number (tabular) **and**
    every meta label (uppercase, tracked) — the mono carries the "terminal" identity.
- All money/number formatting goes through `lib/format.ts` (`formatUsd`,
  `formatCount`, `formatDate`, `signedPct`). Don't format inline.
- The signature element is the **Funding Ladder** (`components/FundingLadder.tsx`):
  rounds as a vertical ledger with bar widths encoding round size. Keep it as the
  one bold element; surrounding sections stay quiet.
- Radii: `rounded-sm` 6px, `rounded-md` 10px, `rounded-lg` 12px, `rounded-full` for
  pills (set via `@theme`). Use them, don't hardcode pixel radii.

#### Components (`components/ui/`)

Tailwind-based primitives re-exported from `index.ts` (token-pure, usable in server and
client components). `components.json` configures shadcn (`@/*` alias, new-york style);
add more shadcn primitives with `npx shadcn@latest add <name>` then theme monochrome.

- **`Button`** — `variant` `primary` (filled ink) / `ghost` (chrome-less text) /
  `outline`; `shape` `pill` | `box`; `size` `sm` | `md`; `block`; renders `next/link`
  when given `href`, else a `<button>`. (cva-based.)
- **Form controls** — `Input` / `Textarea` / `Select` (native, styled, forward all
  native props), `Label`. Legacy `Field` + `FormError` (label+control+error wrapper)
  remain for the auth/admin pages.
- **`Tag`** — `variant` `pill` | `box`, optional `mono` for the mono-uppercase meta
  treatment. **`Card`** — surface + `border-line` panel; `emphasis` → `border-ink`.
  **`SectionHeader`**, **`Eyebrow`**, **`Stat`**, **`EmptyState`**, **`PageContainer`**,
  **`Separator`** — same roles as before, now Tailwind.

**Build new UI from these primitives + Tailwind utilities.** Never re-inline a button,
tag, card, etc. — extend the primitive. Bespoke layout (grids, the Funding Ladder spine)
is just Tailwind utilities in the component/page, no CSS Modules.

#### Forms — react-hook-form + zod

Forms use **react-hook-form** with **zod** validation (shadcn `Form` pattern):

- zod schemas live in `lib/validation/` (`company.ts`, `round.ts`), with a
  `*FormSchema`, `*FormDefaults`, and a `to*Input` mapper to the `@repo/api` payload.
  Form values are string-only; numeric fields validate as digit-strings and convert in
  the mapper. Aligns field names with `@repo/api` `Create*Input`.
- Client: `useForm({ resolver: zodResolver(schema), defaultValues })` inside `<Form>`,
  with the generic `TextField` / `TextareaField` / `SelectField` wrappers
  (`components/ui/fields.tsx`) — label + control + inline `FormMessage` per field.
- Server stays authoritative: the server action re-runs `schema.safeParse` (never trust
  the client), maps with `to*Input`, and returns an `ActionResult`
  (`{ ok } | { ok:false, formError?, fieldErrors? }`, see `lib/validation/utils.ts`).
  `applyServerErrors` pushes server `fieldErrors` back into RHF via `setError`.

### Data

`lib/data.ts` is the data seam. Its getters (`getCompanies`, `getCompany`,
`getMarketStats`, `getMarketTotals`) are **async** and fetch the live NestJS API
through `lib/api.ts` (server-only `API_URL` env, 60s ISR). The mock arrays in the
file remain ONLY as an offline fallback if the API is unreachable in local dev — they
are illustrative, not real. Domain types are re-exported from `@repo/api` (single
source of truth). Company logos resolve from `domain` via Clearbit in
`components/CompanyLogo.tsx`, with a monogram fallback.

### Routes

- `/` — landing: hero, market tape, sector cards, company directory table.
- `/companies/[slug]` — full company profile (funding ladder, investors, people,
  acquisitions, exits, diversity, financials). Missing sections render empty states
  that invite contribution (open-source angle).
- `/admin` — moderation queue (ADMIN only). `/admin/login` signs in via
  `app/api/admin/login` which stores the JWT in an httpOnly `capbase_token` cookie.
  `lib/auth.ts` (`requireAdmin`) gates pages; `lib/admin.ts` + `app/admin/actions.ts`
  (server actions) approve/reject. Keep it strictly monochrome (`admin.module.css`).

Run the web app with `yarn dev` (it serves on port 3001). It expects the API at
`API_URL` (default `http://localhost:3000`).

## Backend (apps/api)

NestJS 11 REST API on port 3000. Auth = JWT + roles (USER/ADMIN), bcrypt. Every
crowdsourced row carries `moderationStatus` (PENDING/APPROVED/REJECTED); public reads
return only APPROVED, `/admin/*` (RBAC) lists pending and flips status. Services map
Prisma rows → shared `@repo/api` types (`src/companies/company.mapper.ts`). DTOs use
`class-validator` and `implements` the shared `Create*Input` types. Config comes from
env (`apps/api/.env`, see `.env.example`).

## Database (packages/db, `@repo/db`)

Single source of truth for the schema. Holds `prisma/schema.prisma`, `prisma/migrations`,
`prisma/seed.ts`, `prisma.config.ts`, and the generated client (`src/generated`, gitignored).
`apps/api` and `apps/jobs` both import `@repo/db` (a thin `PrismaService` extends its
`PrismaClient`). Prisma 7 is Rust-free + uses `@prisma/adapter-pg`; the datasource URL lives
in `prisma.config.ts` (reads `DATABASE_URL`), not the schema. Money is `BigInt`. Contributable
Company/FundingRound rows also have `externalSource`/`externalId` (`@@unique`) for idempotent
ingestion. Run schema commands via `make` or `yarn workspace @repo/db <generate|migrate|seed>`.

### Controlled vocabularies & entity metadata

Controlled vocabularies are TS string-literal unions + a `readonly` const array in `@repo/api`
(`domain/company.ts`), stored as plain `String` columns and validated in DTOs with `@IsIn([...])`
— not Prisma enums. Besides `Stage`/`CompanyStatus`/`InvestorType`/`ExitType`, there is a
**`Sector`/`SECTORS`** vocabulary (the 5 canonical sectors: `Artificial intelligence`, `Fintech`,
`Healthcare`, `Climate`, `Enterprise SaaS`) shared between `Company.primarySector` and
`MarketStat.sector`. This is the connection between companies and the sector tape; `MarketStat`
aggregate numbers stay **seeded**, not computed from companies. Two small status vocabularies also
exist: `OperatingStatus`/`OPERATING_STATUSES` (`Active`/`Closed`) and `CompanyType`/`COMPANY_TYPES`
(`For profit`/`Non-profit`).

Entities carry optional outbound-link / metadata fields (all nullable, `@IsUrl`-validated where a
link): `Company` — `websiteUrl`, `linkedinUrl`, `twitterUrl`, `legalName`, `operatingStatus`,
`companyType`, `primarySector`; `Person` — `linkedinUrl`, `title`; `InvestorHolding` —
`websiteUrl`, `linkedinUrl`. They render as outbound links / facts on the company profile.
SEC-ingested rows leave these null (no SEC→sector mapping yet).

## Jobs (apps/jobs)

NestJS worker (port 3002, health endpoint) that ingests **SEC EDGAR Form D** filings —
the free, official source for US private-placement funding. `@nestjs/schedule` cron
(`CRON_SCHEDULE`) plus a `node dist/backfill [limit]` CLI. Pluggable `IngestionSource`
interface (`src/sources/`) — add Wikidata/OpenCorporates here later. The SEC client sets
`SEC_USER_AGENT` and throttles ≤10 req/s. Ingested rows upsert keyed on
`(externalSource, externalId)` and are **auto-APPROVED** (trusted source).

## Deployment (Docker + Makefile)

Each app has a multi-stage `Dockerfile` (`turbo prune --docker`). `apps/web` uses Next
`output: 'standalone'`. Root `docker-compose.yml` runs postgres + api + web + jobs; the
api container runs `prisma migrate deploy` on boot, and a one-shot `seed` profile loads
demo data. Use the `Makefile`: `make up` (prod stack), `make dev` (local dev servers),
`make ingest` (run a backfill), `make help` for the full list.

## Lint & tooling

`yarn lint` runs flat-config ESLint per workspace via turbo. There is **no `next lint`**
(removed in Next 16); `apps/web` lints with `eslint .` and ignores `.next/**`. Shared
configs live in `@repo/eslint-config` (`base`/`next-js`/`nest-js` + prettier). The lint
gate is **strict**: every script passes `--max-warnings 0`, so any warning fails the run
(the `only-warn` downgrade plugin was removed — recommended-set problems are real errors).
The `lint` turbo task `dependsOn: ["^build"]` because the type-aware rules need workspace
dependency types (`@repo/db`/`@repo/api` `dist`); run `yarn build` first on a fresh
checkout, or just use `yarn lint` (turbo builds deps for you). `packages/db` is excluded
(Prisma + generated client).
