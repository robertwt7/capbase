# Capbase

An open-source alternative to Crunchbase / Pitchbook: **crowdsourced** company and
funding data with **admin moderation**, plus automated ingestion of public **SEC EDGAR
Form D** filings. TurboRepo monorepo, TypeScript end to end.

> Figures in the seed dataset are illustrative demo data, not verified financials.
> Ingested SEC Form D records are real public filings.

## What's inside

```
.
├── apps
│   ├── web    # Next.js 16 (App Router, React 19) — public site + /admin moderation portal (:3001)
│   ├── api    # NestJS 11 REST API — auth, moderation, public reads (:3000)
│   └── jobs   # NestJS worker — SEC EDGAR Form D ingestion, cron + backfill CLI (:3002)
└── packages
    ├── api               # @repo/api — shared domain types (single source of truth)
    ├── db                # @repo/db — Prisma schema, migrations, seed, generated client
    ├── ui                # @repo/ui — shared React components
    ├── eslint-config     # @repo/eslint-config
    ├── jest-config       # @repo/jest-config
    └── typescript-config # @repo/typescript-config
```

### Architecture

- **Shared types** live in `@repo/api` (plain TS interfaces). Every app imports them, so the
  API response shapes and the frontend props never drift.
- **Shared database** lives in `@repo/db` — one Prisma schema + generated client used by both
  `apps/api` and `apps/jobs` (no schema duplication). Postgres via Prisma 7 + `@prisma/adapter-pg`.
- **Moderation model**: every contributable row has a `moderationStatus`
  (`PENDING`/`APPROVED`/`REJECTED`). Public reads return only `APPROVED`; admins approve/reject
  via `/admin`. Logged-in users submit contributions (land as `PENDING`).
- **Auth**: JWT + `USER`/`ADMIN` roles (bcrypt). The web admin portal stores the JWT in an
  httpOnly cookie set by a Next route handler.
- **Ingestion**: `apps/jobs` pulls SEC EDGAR Form D daily index + `primary_doc.xml`, normalizes
  via a pluggable `IngestionSource` interface, and upserts idempotently (keyed on
  `externalSource`/`externalId`). Ingested rows are auto-`APPROVED` (SEC is an official source).

### Design system — "monochrome terminal ledger"

The web UI is deliberately monochrome (graphite ramp) so company logos are the only color.
Tokens in `apps/web/app/globals.css`; fonts Archivo / IBM Plex Sans / IBM Plex Mono. All
money/number formatting goes through `apps/web/lib/format.ts`. See `CLAUDE.md` for details.

## Quick start

Requires Docker, Node ≥ 18, and Yarn 4 (via Corepack).

### Local development

```bash
make install        # yarn install
make db-up          # start Postgres (docker compose), apply migrations, seed demo data
make dev            # run web (:3001), api (:3000), jobs (:3002) with hot reload
```

Then open <http://localhost:3001>. Admin portal: <http://localhost:3001/admin>
(default seeded admin — `admin@capbase.dev` / `admin12345`).

Run a one-off ingestion of recent SEC Form D filings into your dev DB:

```bash
make ingest             # backfill up to INGEST_LIMIT (default 50) filings
make ingest LIMIT=10    # smaller batch
```

### Production-like stack (everything in Docker)

```bash
make up         # build images + start postgres, api, web, jobs (migrations run on boot)
make seed       # one-shot: load demo data
make logs       # tail all services
make down       # stop the stack (keeps the DB volume)
```

The `jobs` container runs the ingestion on a cron (`CRON_SCHEDULE`, default daily 06:00).
Set `INGEST_ON_BOOT=true` to also run once on startup, or trigger a manual backfill:

```bash
make ingest-prod        # run a backfill inside the jobs container
```

See `make help` for the full command list. Override env via a root `.env`
(e.g. `JWT_SECRET`, `ADMIN_PASSWORD`, `SEC_USER_AGENT`, `CRON_SCHEDULE`).

## Common commands

| Command | Description |
| --- | --- |
| `make dev` | Run all apps locally (hot reload) |
| `make build` | `turbo build` all workspaces |
| `make test` / `make test-e2e` | Run unit / e2e tests |
| `make db-migrate` | Create/apply a dev migration (`@repo/db`) |
| `make db-seed` | Re-seed the dev database |
| `make up` / `make down` | Start / stop the Docker stack |
| `make ingest` | Run SEC Form D backfill (local) |
| `make help` | List every target |

Turbo tasks can also be run directly: `yarn dev`, `yarn build`, `yarn test`, `yarn lint`.

## Notes

- The API requires a `DATABASE_URL` (and `JWT_SECRET` in production). Copy each app's
  `.env.example` to `.env` for local runs; Docker injects env via `docker-compose.yml`.
- Postgres is exposed on host port **5433** (to avoid clashing with a local 5432).
- SEC requires a descriptive `SEC_USER_AGENT` with a contact email and ≤10 req/s — the
  ingestion client honors both.
