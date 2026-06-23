# Capbase — Admin portal, live data, SEC ingestion jobs, Docker deploy

## Context

The previous phase (`thoughts/shared/plans/2026-06-22-lets-create-api-for-peaceful-robin.md`)
shipped the **NestJS API**: auth (JWT + USER/ADMIN), per-entity `moderationStatus`
moderation, the full Prisma schema + seed, and the shared `@repo/api` domain types. Today:

- `apps/web` renders **mock** data from `lib/data.ts` (sync getters that re-export `@repo/api` types).
- `apps/api` serves real data from Postgres but **nothing consumes it** and there is **no admin UI**.
- There is **no ingestion worker** and **no Dockerfiles** (only a Postgres `docker-compose.yml`).

This phase closes those gaps in four tracks, in order:

1. **Extract Prisma into a shared `@repo/db` package** so both `apps/api` and the new jobs
   worker can write to the same DB (no schema drift).
2. **Connect `apps/web` to the live API** (swap mock getters → server-side `fetch`).
3. **Admin moderation portal** as `/admin/*` routes inside `apps/web` (httpOnly-cookie auth).
4. **`apps/jobs`** NestJS worker that ingests **SEC EDGAR Form D** filings on a cron and
   upserts companies + funding rounds (auto-`APPROVED`, deduped by SEC id).
5. **Docker/Compose** for full-stack deployment.

### Confirmed decisions
- Jobs → DB: **shared `@repo/db`** (extract Prisma out of `apps/api`).
- Admin UI: **`/admin` routes in `apps/web`** (reuse design system).
- Ingested data: **auto-`APPROVED`**, tagged with `externalSource`/`externalId`.
- Admin session: **httpOnly cookie** set by a Next route handler proxying `/auth/login`.

### Why SEC EDGAR Form D
Every US company raising private capital must file **Form D** with the SEC — it is the
official upstream source Crunchbase/Pitchbook themselves ingest, and it is **free**.
- Discovery: daily index files `https://www.sec.gov/Archives/edgar/full-index/{year}/QTR{q}/form.idx`
  (filter form type `D`), or the EFTS full-text search `https://efts.sec.gov/LATEST/search-index?forms=D&...`.
- Structured data per filing: `https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/primary_doc.xml`
  → issuer name, jurisdiction, industry group, total offering amount, amount sold, related persons.
- Constraints: must send a `User-Agent` header with a contact email; ≤10 requests/sec.
- Future sources (Wikidata for logos/domains, OpenCorporates) plug into the same source interface.

---

## Track 1 — Extract `@repo/db` (shared Prisma)

Today the schema lives in `apps/api/prisma/`, the generated client outputs to
`apps/api/src/generated/prisma`, and only **two** app files import it
(`src/prisma/prisma.service.ts:5`, `src/companies/company.mapper.ts:25`) plus `prisma/seed.ts`.
Prisma 7 specifics (Rust-free `prisma-client` generator, `@prisma/adapter-pg`, datasource URL in
`prisma.config.ts` not the schema, generated client gitignored) carry over unchanged.

**New `packages/db/`:**
- `package.json` — name `@repo/db`; deps `@prisma/client`, `@prisma/adapter-pg`, `pg`; dev `prisma`, `tsx`.
  Scripts: `generate` (`prisma generate`), `migrate` (`prisma migrate dev`), `seed`, `build` (`prisma generate`).
  `exports`: `.` → a small `src/index.ts` barrel.
- `prisma/schema.prisma` — moved from `apps/api`; generator `output = "../src/generated/prisma"`.
- `prisma.config.ts` — moved (same shape; `datasource.url = env('DATABASE_URL')`).
- `prisma/seed.ts` — moved verbatim (it ports mock companies + market stats + admin/demo users).
- `src/index.ts` — re-export `PrismaClient`, all model/enum types from `./generated/prisma/client`,
  **and** a `createPrismaClient(connectionString)` factory that wires `PrismaPg` (used by jobs;
  `apps/api`'s Nest `PrismaService` keeps its own thin wrapper).
- `tsconfig.json` extends `@repo/typescript-config/nestjs.json`.

**Schema change for dedup (new migration `add_external_source`):** add to **Company** and
**FundingRound**: `externalSource String?`, `externalId String?`, with
`@@unique([externalSource, externalId])`. Lets the jobs worker upsert idempotently on
`(SEC_EDGAR, accession/CIK)`.

**`apps/api` edits (surgical):**
- Add `@repo/db` dependency; drop `@prisma/client`/`adapter-pg`/`prisma`/`pg` from `apps/api` if no
  longer directly needed (keep `@prisma/adapter-pg` only if `PrismaService` still constructs the adapter — it does).
- `src/prisma/prisma.service.ts` and `src/companies/company.mapper.ts`: change
  `from '../generated/prisma/client'` → `from '@repo/db'`.
- Delete `apps/api/prisma/`, `apps/api/prisma.config.ts`, `apps/api/src/generated/`.
- `package.json` scripts: point `prisma:*`/`db:seed`/`build` at `@repo/db`
  (e.g. `build`: `yarn workspace @repo/db generate && nest build`), or run via turbo `^build`.
- `turbo.json`: `@repo/db#build` (generate) becomes a `^build` dependency of `api` and `jobs`;
  add `db/generated/**`-style outputs as needed.

**Verify:** `yarn workspace @repo/db generate` → `migrate dev --name add_external_source` →
`db:seed` → `yarn workspace api build` passes → `yarn workspace api dev` still serves `/companies`.

---

## Track 2 — Connect `apps/web` to the live API

The two call sites are `app/page.tsx` (`getCompanies()`) and
`app/companies/[slug]/page.tsx` (`getCompany(slug)` + `generateStaticParams`). Both are server
components; `lib/data.ts` getters are currently **sync**.

- **New `apps/web/lib/api.ts`** — `apiFetch(path, init?)` helper using a server-only
  `API_URL` env (default `http://localhost:3000`), `next: { revalidate: 60 }` for ISR.
- **`apps/web/lib/data.ts`** — keep the type re-exports; replace the mock arrays/getters with
  **async** `getCompanies()`, `getCompany(slug)`, `getMarketStats()`, `getMarketTotals()` that call
  `/companies`, `/companies/:slug`, `/market/stats`, `/market/totals`. Keep mock arrays as an
  optional fallback only if the fetch fails (so local dev without the API still renders).
- **Call sites** — `await` the getters. Remove `generateStaticParams` from the company page (data is
  live/large now) and render dynamically with ISR, OR keep it fed by `await getCompanies()` if a
  build-time DB is acceptable; default to **dropping it** to avoid a build-time DB dependency.
- **`apps/web/.env.example`** — `API_URL=http://localhost:3000`.

**Verify:** `docker compose up -d postgres` + API running + `yarn workspace web dev` → landing table
and a company profile render seeded DB data (not mock); confirm a `PENDING` row is absent from public reads.

---

## Track 3 — Admin moderation portal (`apps/web/app/admin/*`)

Consumes the existing admin API: `GET /admin/submissions?status=PENDING`,
`PATCH /admin/submissions/:type/:id { status }`, plus `/auth/login` + `/auth/me`. Reuse the shared
`PendingSubmissionsResponse` / `ReviewableType` / `ModerationDecisionInput` types from `@repo/api`.

- **Auth seam:**
  - `app/api/admin/login/route.ts` — POST proxies `/auth/login`; on success sets an **httpOnly,
    sameSite=lax** cookie `capbase_token` with the JWT; returns role.
  - `app/api/admin/logout/route.ts` — clears the cookie.
  - `lib/auth.ts` — `getSession()` reads the cookie (`next/headers cookies()`), calls `/auth/me`;
    `requireAdmin()` redirects to `/admin/login` if missing/non-admin.
- **Admin data:** `lib/admin.ts` — `getSubmissions(status)` and `moderate(type, id, status)` (a
  **server action**), both attaching `Authorization: Bearer <cookie>` and `cache: 'no-store'`.
- **Routes:**
  - `app/admin/login/page.tsx` — minimal client login form → posts to the login route handler.
  - `app/admin/layout.tsx` — calls `requireAdmin()`; renders an admin shell (monochrome).
  - `app/admin/page.tsx` — server component: status filter (PENDING/APPROVED/REJECTED), per-type
    counts, a ledger-style table of submissions, each row with **Approve/Reject** buttons wired to
    the `moderate` server action (revalidate on submit).
- **Design:** strictly reuse `app/globals.css` tokens, the three fonts, and `lib/format.ts`
  (`formatUsd`, `formatDate`, …). No new colors/frameworks (per `CLAUDE.md` monochrome rule).

**Verify:** log in as seeded admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`); submit a contribution via API as
the demo user → it appears in `/admin` PENDING; Approve → it shows on the public profile; Reject →
stays hidden. Non-admin / logged-out hitting `/admin` redirects to login.

---

## Track 4 — `apps/jobs` SEC EDGAR ingestion worker (NestJS)

Scaffold mirrors `apps/api` (NestJS 11, `tsconfig` extends `@repo/typescript-config/nestjs.json`,
`nest-cli.json`, eslint `nest-js`, jest `nest`). Name `jobs` in `package.json`.

- **Deps:** `@nestjs/{common,core,config,schedule}`, `@repo/db`, `@repo/api`, an XML parser
  (`fast-xml-parser`). Uses `@nestjs/schedule` `@Cron()` for the recurring run.
- **`src/prisma`** — a `PrismaService` like `apps/api`'s, built on `@repo/db`'s
  `createPrismaClient(DATABASE_URL)`.
- **`src/ingest/`:**
  - `edgar.client.ts` — fetch daily Form D index + each `primary_doc.xml`; sets the required
    `User-Agent` (from `SEC_USER_AGENT` env) and throttles to ≤10 req/s.
  - `form-d.parser.ts` — parse XML → a normalized `{ company, round }` shape using `@repo/api` types.
  - `ingest.service.ts` — `upsert` Company by `(externalSource:'SEC_EDGAR', externalId: CIK)` and
    FundingRound by `(…, externalId: accessionNumber)`; set `moderationStatus = 'APPROVED'`;
    derive `slug`, `amountUsd` (BigInt), `stage`/`date` from filing fields.
  - `ingest.module.ts` + a `@Cron(CRON_SCHEDULE)` job; also a **CLI entry** (`src/backfill.ts` run via
    `nest start`-style script) for one-off historical backfill over a date range.
- **`src/source/` interface** — `IngestionSource` so Wikidata/OpenCorporates can be added later
  without touching the scheduler.
- **`.env.example`:** `DATABASE_URL`, `SEC_USER_AGENT="capbase-ingest you@example.com"`,
  `CRON_SCHEDULE="0 6 * * *"`.
- **`turbo.json`:** `jobs` `dependsOn ^build` (needs `@repo/db` generated client).

**Verify:** `yarn workspace jobs build`; run the backfill against a small recent date window → new
companies/rounds appear in the DB with `externalSource='SEC_EDGAR'`, `moderationStatus='APPROVED'`,
and show up in the public web app; re-running is **idempotent** (upsert, no dupes).

---

## Track 5 — Docker & Compose deployment

Use Turborepo's pruned-Docker pattern for small images.

- **`apps/{api,web,jobs}/Dockerfile`** — multi-stage: a `turbo prune --scope=<app> --docker`
  builder stage, `yarn install`, `turbo run build --filter=<app>`, then a slim runtime stage.
  - `api`: runs `node dist/main`; entrypoint runs `prisma migrate deploy` (via `@repo/db`) first.
  - `web`: Next standalone output (`output: 'standalone'` in `next.config`); `node server.js` on 3001.
  - `jobs`: `node dist/main` (long-running scheduler).
- **`.dockerignore`** at repo root (node_modules, .next, dist, .git, .env).
- **`docker-compose.yml`** — extend the existing file (keep `postgres` on host 5433): add `api`
  (3000), `web` (3001, `API_URL=http://api:3000`), `jobs` services, all depending on `postgres`
  healthcheck; pass `DATABASE_URL`, `JWT_SECRET`, `ADMIN_*`, `SEC_USER_AGENT` via env. A one-shot
  `migrate` step (or api entrypoint) applies migrations + optional seed.
- **`next.config`** — add `output: 'standalone'`.

**Verify:** `docker compose build` then `docker compose up`; web on `localhost:3001` serves live API
data, `/admin` login works, jobs container logs a scheduled/backfill ingest run, migrations applied
on a fresh volume.

---

## Files at a glance

- **New:** `packages/db/**`; `apps/web/lib/api.ts`, `apps/web/lib/auth.ts`, `apps/web/lib/admin.ts`,
  `apps/web/app/admin/**`, `apps/web/app/api/admin/{login,logout}/route.ts`, `apps/web/.env.example`;
  `apps/jobs/**`; `apps/{api,web,jobs}/Dockerfile`, root `.dockerignore`.
- **Modify:** `apps/api/src/prisma/prisma.service.ts`, `apps/api/src/companies/company.mapper.ts`,
  `apps/api/package.json`; `apps/web/lib/data.ts`, `app/page.tsx`,
  `app/companies/[slug]/page.tsx`, `apps/web/next.config.*`, `apps/web/package.json`;
  root `docker-compose.yml`, `turbo.json`.
- **Move/Delete:** `apps/api/prisma/**` + `apps/api/prisma.config.ts` + `apps/api/src/generated/**`
  → relocated under `packages/db/`.

## Suggested execution order
Track 1 → Track 2 → Track 3 → Track 4 → Track 5 (each independently verifiable; 2–4 only need the
DB + API from 1). Tracks 3 and 4 are independent of each other and could be parallelized.
