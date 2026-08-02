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
the not-yet-redesigned `admin` and `(account)` **profile** pages; the `(account)` auth
forms — login/register — now follow the RHF+zod + Tailwind pattern. Back-compat token
aliases `--font-body`/`--page-max`/`--page-pad` exist only for the remaining modules and
will go when those routes are redesigned.)

### Design system — "parchment ledger"

The interface is strict single-hue monochrome on warm cream paper, like an aged
ledger book. Surfaces are **tonal**: `--paper` is the cream page ground and
`--surface` (cards, tables, inputs) is one soft step lighter on the same warm axis —
never pure white — so sheets blend into the ground and hairline borders do the
separating. The graphite ramp is tinted warm (taupe grays) so ink → paper is one
continuous hue. Company
logos are the only saturated color on screen. When adding UI, hold this line: no
accent colors, no gradients, no pure `#fff`. Emphasis comes from weight, size, and
the mono numerals — not hue. Bordered containers that sit on the page must carry
their own `bg-surface`; never rely on the page ground being near-white (it isn't
anymore).

- The ledger ramp is exposed as Tailwind colors via `@theme`: use `text-ink`,
  `bg-paper`, `bg-surface`, `text-graphite-{200..900}`, `border-line`, plus the shadcn
  semantic colors (`bg-primary`, `text-muted-foreground`, `border-border`, …) which all
  map onto the ramp. Never hardcode hex values. **The one sanctioned use of red is
  validation/error feedback** — `--destructive` / `text-destructive` (the `FormError`
  box, `FormMessage` field errors, and invalid-control borders/rings). Destructive
  *actions* (delete-style menu items) stay monochrome — emphasis is weight/border,
  never red. Everything else stays graphite.
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

`Button`, `Card`, `Badge`, `Input`, `Textarea`, `Select`, `Label`, `Separator`, `Form` are
**real shadcn/ui components** (CLI-generated, then re-themed monochrome onto the existing CSS
variables — no accent, no red destructive). Files are lowercase (`button.tsx`, `card.tsx`,
`badge.tsx`, …) per shadcn convention; the barrel `index.ts` re-exports the capitalised
public API (`Button`, `Card`, `Badge`, …). `components.json` is wired (`@/*` alias, new-york,
`cssVariables`); add more primitives with `npx shadcn@latest add <name>` then theme monochrome.
The generated files import the unified `radix-ui` package — rewrite those to the individual
`@radix-ui/react-*` packages (already deps) to stay consistent and avoid a redundant dep.

- **`Button`** — keeps the project API (not shadcn's default variants): `variant` `primary`
  (filled `bg-primary`) / `ghost` (chrome-less text) / `outline`; `shape` `pill` | `box`;
  `size` `sm` | `md`; `block`; renders `next/link` when given `href`, else a `<button>`. (cva.)
- **`Badge`** (was `Tag`) — `variant` `pill` | `box`, optional `mono` for the mono-uppercase
  meta treatment (via `badgeVariants`).
- **`Card`** — single-panel shadcn `Card` re-themed to `surface` + `border-line`; `emphasis`
  → `border-ink`. Padding comes from the caller's `className` (the `CardHeader`/`CardContent`
  sub-parts are exported but not yet used).
- **Form controls** — `Input` / `Textarea` (share one `controlClass` surface, exported from
  `input.tsx`), `Label`, and `Select` is shadcn's **Radix Select** (`SelectTrigger` /
  `SelectContent` / `SelectItem` / `SelectValue` / …). **`FormError`** (`FormError.tsx`) is
  the form-level (non-field) error box, used by both the RHF forms and the auth/admin pages.
- **`SectionHeader`**, **`Eyebrow`**, **`Stat`**, **`EmptyState`**, **`PageContainer`** stay
  bespoke Tailwind role components (no shadcn equivalent), as does `FundingLadder`.

**Build new UI from these primitives + Tailwind utilities.** Never re-inline a button,
badge, card, etc. — extend the primitive. Bespoke layout (grids, the Funding Ladder spine)
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
  `SelectField` drives the Radix Select via the `FormField` `Controller` (`onValueChange`);
  pass `<SelectItem>` children and an optional `placeholder` for the empty state.
- Server stays authoritative: the server action re-runs `schema.safeParse` (never trust
  the client), maps with `to*Input`, and returns an `ActionResult`
  (`{ ok } | { ok:false, formError?, fieldErrors? }`, see `lib/validation/utils.ts`).
  `applyServerErrors` pushes server `fieldErrors` back into RHF via `setError`.

### Data

`lib/data.ts` is the data seam. Its getters are **async** and fetch the live NestJS API
through `lib/api.ts` (server-only `API_URL` env, 60s ISR). List reads are **paginated
server-side**: `getCompanies`/`getInvestors` take a `CompanyListQuery`/`InvestorListQuery`
(q/filters/sort/page/pageSize, parsed leniently from `searchParams` by `lib/list-params.ts`)
and return `Paginated<T>` (`{ items, total, page, pageSize }` from `@repo/api`). Directory
pages are URL-driven: the client components only mirror filter state to the URL (debounced
`router.replace`, page resets on filter change) and render the page plus `<Pagination>`;
the server component refetches. The mock arrays in the file remain ONLY as an offline
fallback if the API is unreachable in local dev — they are illustrative, not real. Domain
types are re-exported from `@repo/api` (single source of truth). Company logos resolve from
`domain` via Clearbit in `components/CompanyLogo.tsx`, with a monogram fallback.

### Routes

- `/` — landing: hero, market tape, sector cards, company directory table.
- `/companies/[slug]` — full company profile (funding ladder, investors, people,
  acquisitions, exits, diversity, financials). Missing sections render empty states
  that invite contribution (open-source angle).
- `/investors` — investor directory (URL-driven filters, same pattern as companies);
  `/investors/[slug]` — investor profile: facts, fund assets, portfolio grid, or an
  empty state inviting a contribution.
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
env (`apps/api/.env`, see `.env.example`). Registration sends a welcome email through
`MailModule` (`src/mail/`, Resend) — a no-op that only logs when `RESEND_API_KEY` is unset.

## Database (packages/db, `@repo/db`)

Single source of truth for the schema. Holds `prisma/schema.prisma`, `prisma/migrations`,
`prisma/seed.ts`, `prisma.config.ts`, and the generated client (`src/generated`, gitignored).
`apps/api` and `apps/jobs` both import `@repo/db` (a thin `PrismaService` extends its
`PrismaClient`). Prisma 7 is Rust-free + uses `@prisma/adapter-pg`; the datasource URL lives
in `prisma.config.ts` (reads `DATABASE_URL`), not the schema. Money is `BigInt`. Contributable
Company/FundingRound rows also have `externalSource`/`externalId` (`@@unique`) for idempotent
ingestion. Run schema commands via `make` or `yarn workspace @repo/db <generate|migrate|seed>`.

**Seeding is phased** (Flyway-style): `prisma/seeds/` holds ordered `Seed` phases
(`001-admin-user` bootstrap, `002-demo-companies` demo, …) registered in `seeds/index.ts`;
`prisma/seed.ts` is the runner, applying only phases not yet recorded in the `SeedHistory`
table. `kind: 'demo'` phases need `SEED_DEMO=true` (set by `make db-seed`/`db-init` and the
compose seed profile); plain `seed` is bootstrap-only and safe on prod. To add seed data,
append a new `NNN-*.ts` phase (idempotent upserts, never `deleteMany`; never edit a shipped
phase). `make db-baseline` marks all phases applied without running (pre-runner DBs);
`make db-reset` is the explicit destructive wipe-and-reseed for local dev.

### Controlled vocabularies & entity metadata

**Investors are a first-class entity.** The `Investor` table holds ~7.4k firms (slug, type, HQ,
website, and for ADV rows CRD/CIK/fund count/gross fund assets); `InvestorHolding` and
`RoundInvestor` carry a nullable `investorId` pointing at it. Nullable only because seed phase
`002` shipped before the column existed and seed phases are immutable — every write path (ingest
and contribution) populates it, so treat non-null as an invariant. `/investors` and
`/investors/[slug]` read the table directly. **Most firms have an empty portfolio and that is
expected**: no free source discloses investor→company edges (Form D names the issuer, Form ADV the
funds; only Wikidata's ~1.5k P1951 edges are automatable), so empty profiles invite a contribution
rather than being hidden.

Controlled vocabularies are TS string-literal unions + a `readonly` const array in `@repo/api`
(`domain/company.ts`), stored as plain `String` columns and validated in DTOs with `@IsIn([...])`
— not Prisma enums. `InvestorType` covers `Venture`/`Growth`/`Angel`/`Corporate`/`Private equity`/
`Accelerator`/`Hedge fund`/`Sovereign wealth` — the last three are derived from source *structure*
(Wikidata P31 class, ADV fund-type columns), never guessed from the firm's name. Besides
`Stage`/`CompanyStatus`/`InvestorType`/`ExitType`, there is a
**`Sector`/`SECTORS`** vocabulary (14 canonical sectors: the original `Artificial intelligence`/
`Fintech`/`Healthcare`/`Climate`/`Enterprise SaaS` plus `Technology`, `Financial services`,
`Energy`, `Real estate`, `Industrials`, `Consumer & retail`, `Transport`, `Media & telecom`,
`Education`) shared between `Company.primarySector` and `MarketStat.sector`. This is the
connection between companies and the sector tape; market stats (`MarketStat`/`MarketTotals`)
are **computed live** by the API's `MarketService` from approved Company/FundingRound rows —
there are no seeded market tables. Two small status vocabularies also
exist: `OperatingStatus`/`OPERATING_STATUSES` (`Active`/`Closed`) and `CompanyType`/`COMPANY_TYPES`
(`For profit`/`Non-profit`).

Entities carry optional outbound-link / metadata fields (all nullable, `@IsUrl`-validated where a
link): `Company` — `websiteUrl`, `linkedinUrl`, `twitterUrl`, `legalName`, `operatingStatus`,
`companyType`, `primarySector`; `Person` — `linkedinUrl`, `title`; `InvestorHolding` —
`websiteUrl`, `linkedinUrl`. They render as outbound links / facts on the company profile.
SEC rows get `primarySector` via the deterministic Form D map
(`apps/jobs/src/sources/sec-edgar/sector-map.ts`); Wikidata rows via the `SECTOR_RULES`
keyword heuristic. `make backfill-sectors` fills missing sectors from stored `industry[]`.

## Jobs (apps/jobs)

NestJS worker (port 3002, health endpoint) with two pluggable `IngestionSource`s
(`src/sources/`, add OpenCorporates etc. later):

- **SEC_EDGAR** — Form D filings (free, official source for US private-placement
  funding). Walks N days of daily indexes (`INGEST_DAYS`), **skips pooled
  funds/SPVs** by default (`INGEST_SKIP_FUNDS`), keys D/A amendments to the
  original filing's accession, and extracts executives/directors from
  `relatedPersonsList`. Client sets `SEC_USER_AGENT`, throttles ≤10 req/s.
- **WIKIDATA** — enrichment for the ~6.4k notable companies carrying investor
  (P1951) statements: metadata (website/LinkedIn/HQ/sector), investors,
  founders/CEOs, acquisitions, exits. Throttled ~1 req/s SPARQL
  (`WDQS_USER_AGENT`, defaults to `SEC_USER_AGENT`). No funding rounds. Also
  enumerates ~640 **investor firms** by P31 class (`investor-class-map.ts`),
  independent of any P1951 edge.
- **SEC_ADV** — the investor universe: ~7k VC/PE firms from the monthly Form ADV
  bulk files (name, CRD/CIK, HQ, website, fund counts, gross fund assets). A
  *monthly snapshot*, so `days` is ignored and it stays off the daily cron; pin a
  month with `ADV_SNAPSHOT` for a reproducible run. Contributes **no** company
  records — Form ADV never names portfolio companies.

The `@nestjs/schedule` cron (`CRON_SCHEDULE`) runs `INGEST_SOURCES` (default
SEC-only). Backfills: `make ingest DAYS=N LIMIT=N SOURCE=all|SEC_EDGAR|WIKIDATA|SEC_ADV`
(→ `node dist/backfill [days] [limit] [source]`), plus `make ingest-investors`
(ADV + Wikidata firms) and `make ingest-all` (everything). All ingested rows —
companies, rounds, the child entities (people/investors/acquisitions/exits) and
standalone investor firms — upsert keyed on `(externalSource, externalId)` and are
**auto-APPROVED** (trusted sources). `IngestService` also **matches & enriches**: a
record whose company matches an existing row by domain or normalized name fills
that row's blank fields instead of creating a duplicate (never overwriting
name/stage/status or human-written copy). The same match-and-enrich runs for
investor firms, keyed on domain then `normalizeInvestorName` (which strips legal
suffixes only — "Greylock Partners" and "Greylock Capital Management" are
different firms).

**Domains are a match key, so they must identify the entity.** `src/util/domain.ts`
classifies a URL host as identifying, social, or platform; sources publish a
`domain` only for the first kind. This is not theoretical: 3,295 ADV filers list a
linkedin.com URL as their website and 21 list the same medium.com blog — matching
on those merges unrelated firms into one investor.

Unit tests: `yarn workspace jobs test` (jest, pure parser/mapper/service specs).
Rebuilding the whole dataset from scratch, locally or on prod: **`docs/DATA_REBUILD.md`**.

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
