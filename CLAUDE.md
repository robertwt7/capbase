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

Next.js 16 (App Router, React 19). Styling is plain CSS Modules + design tokens in
`app/globals.css` — there is no Tailwind. Keep that convention; do not add a CSS
framework without being asked.

### Design system — "monochrome terminal ledger"

The interface is deliberately monochrome (graphite ramp) so that company logos are
the only color on screen. When adding UI, hold this line: no accent colors, no
gradients. Emphasis comes from weight, size, and the mono numerals — not hue.

- Tokens live in `app/globals.css` (`:root`). Use `--ink`, `--paper`, `--surface`,
  the `--graphite-*` ramp, and `--line`. Never hardcode hex values in components.
- Type roles (loaded via `next/font/google` in `app/layout.tsx`):
  - `--font-display` → Archivo. Headlines, company names, big figures.
  - `--font-body` → IBM Plex Sans. Body text and labels.
  - `--font-mono` → IBM Plex Mono. Every financial figure / number, tabular.
- All money/number formatting goes through `lib/format.ts` (`formatUsd`,
  `formatCount`, `formatDate`, `signedPct`). Don't format inline.
- The signature element is the **Funding Ladder** (`components/FundingLadder.tsx`):
  rounds as a vertical ledger with bar widths encoding round size. Keep it as the
  one bold element; surrounding sections stay quiet.

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
