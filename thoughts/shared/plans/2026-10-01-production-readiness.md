# Production readiness — Implementation Plan

## Overview

Capbase has the features for an MVP: 7 ingest sources, citations and revisions, moderation, merges, sharded SEO and sitemaps, legal pages, and a hardened single-VPS runbook. What it lacks is the *operational and safety* work needed to run on the public internet. This plan covers the launch blockers (Phase 1) and the hardening (Phase 2) agreed for go-live at `capbase.fyi`. Product gaps are listed as post-launch follow-ups (Phase 3) and are not built here.

Choices agreed up front:
- **Error tracking:** self-hosted **GlitchTip**, plus a free external uptime ping.
- **Off-site backups:** **Cloudflare R2 / Backblaze B2** via `rclone`.
- **Bot protection:** **Cloudflare Turnstile**.

## Current State Analysis

These findings come from three read-only audits (security, ops, product) on 2026-10-01.

### An API outage shows made-up data
`apps/web/lib/data.ts` catches every API error and returns hand-written mock arrays, with no `NODE_ENV` guard. This affects `getCompanies` (~L510), `getCompanyDetail` (~L559, which renders a full *unlocked* mock profile), `getInvestors` (~L647), `getFunds` (~L683), `getInvestor` (~L693) and the market getters. Only the sitemap and people getters return empty results. For an open-data site, fake companies in production are worse than downtime.

### No rate limiting anywhere
There is no `@nestjs/throttler` in `apps/api` and no `limit_req` in `infra/nginx/conf.d/capbase.conf`. `POST /auth/login`, `POST /auth/register` and every contribution POST in `companies.controller.ts` are unthrottled. All API traffic is proxied through Next, so an API-side limiter would only see the web container's IP. The real limit has to be at nginx, or the client IP has to be forwarded.

### The give-to-get gate can be gamed
`UsersService.lastContributionAt` (`apps/api/src/users/users.service.ts:105`) takes the latest `createdAt` across contributable models filtered by `submittedById` only. A PENDING or REJECTED junk submission unlocks full access for the whole window (`companies.service.ts:170-172`).

### Session model
- `JWT_SECRET` comes from `getOrThrow` and `JWT_EXPIRES_IN` defaults to `7d` (`auth.module.ts:20-25`).
- The role is signed into the token and trusted from it (`jwt.strategy.ts:25-27`), so a demoted admin keeps admin for up to 7 days.
- Logout only deletes the cookie. A password change does not invalidate existing tokens.
- `User` (`schema.prisma:31-37`) has no ban flag, no `tokenVersion` and no reset-token table.
- There is no forgot-password flow.
- Cookie flags are fine: `httpOnly`, `sameSite: 'lax'`, and `secure` in production.

### API bootstrap (`apps/api/src/main.ts`)
- `enableCors()` is called with no options.
- There is no `helmet` and no `enableShutdownHooks`.
- `ValidationPipe({ whitelist, transform })` is set without `forbidNonWhitelisted`.
- The port is hardcoded (`listen(3000)`).
- `ConfigModule.forRoot({ isGlobal: true })` has no schema.
- The login and register DTOs have no `MaxLength`, so an arbitrarily long password reaches bcrypt.
- The compose healthcheck hits `GET /` (hello-world), which never touches the DB.

### Web
- There are no `error.tsx`, `not-found.tsx` or `global-error.tsx` files. `notFound()` is called in 7 pages and renders the default Next 404.
- GA4 loads unconditionally when `NEXT_PUBLIC_GA_ID` is set (`layout.tsx:52,63`). There is no consent banner, although `(legal)/privacy` names the `_ga` cookies.
- On mobile, the primary nav is `max-md:hidden` (`SiteHeader.tsx:23`) with no drawer.
- There is no skip link, and the root layout has no shared `<main>` landmark.
- `next.config.js` sets no headers. nginx sets HSTS (without `includeSubDomains`), nosniff and Referrer-Policy, but no CSP, frame-ancestors or Permissions-Policy.

### Ops
- **CI:** none. There is no `.github/`. `apps/api` has 19 specs (3 of them supertest e2e), `apps/jobs` has 29 and `packages/api` has 1. `apps/web` has 0.
- **Observability:** no error tracking, uptime monitoring or alerting.
- **Backups:**
  - What exists: nightly encrypted, verified dumps (`scripts/db-backup.sh`), 14-day retention.
  - What's missing: they stay **on the same VPS**. The `BACKUP_UPLOAD_CMD` hook (L86-88) is never set, and nothing alerts on failure.
- **Migrations:** they run on api boot. There is no pre-migrate snapshot, and images aren't tagged, so the only rollback is a restore.
- **Docker:**
  - Containers run as root.
  - web, jobs and nginx have no healthcheck.
  - `certbot/certbot` is unpinned.
- **Ingest locking:** an in-process flag only (`ingest.scheduler.ts:15,37-41`). A manual `make ingest-prod` can run alongside the cron.

### Search
- Every directory search uses Prisma `contains` with `mode: 'insensitive'`, i.e. an `ILIKE '%q%'` query (`companies.service.ts:105`, `funds.service.ts:32`, `people.service.ts:56`, investors).
- There is no `pg_trgm` index, so each query scans the whole table on 36k+ companies, ~95k funds and ~46k role rows.

## Desired End State

- An API outage in production shows an honest error page, never mock data.
- Auth endpoints return 429 under brute force. Contribution endpoints are rate-limited and Turnstile-protected.
- Only APPROVED contributions unlock gated data.
- **Sessions:**
  - Password reset works.
  - A password change, reset or ban invalidates existing sessions.
  - The role is read from the DB on every request.
- Every PR runs build, lint, unit and e2e tests.
- Errors from web, api and jobs reach GlitchTip. An external monitor pages when the box is down.
- Nightly backups land off-site, and failures alert.
- Directory search uses trigram indexes.
- Mobile users can navigate. GA loads only after consent.

## What We're NOT Doing

Phase 3 is tracked here and built after launch:
- Rejection reasons and approve/reject emails.
- A `/search` page across all entities.
- Bulk approve.
- An admin audit-log view.
- A person-suppress UI.
- Standalone investor and person contributions.
- Edit and withdraw own pending submissions.
- Email verification.
- Account deletion.
- OpenAPI docs and CSV export.
- OG images for investor and person pages.
- A data-licence page.
- A `/contact` or correction form.
- Brotli.
- Structured geography (`thoughts/shared/tickets/2026-08-16-structured-geography.md`).
- Web unit tests and a Playwright smoke test.

Also out of scope:
- Zero-downtime / blue-green deploys. A short restart window is acceptable at launch.
- Point-in-time recovery (WAL archiving). Nightly dumps plus a pre-migrate snapshot are enough to start.

## Implementation Approach

The plan is ordered so small, high-value code fixes land first and CI is in place before the larger schema changes. Infra work goes last because it can only be verified on the VPS. Each numbered section is its own commit-sized change.

Execution order:
1. 1.1 → 1.2 → 1.3 (code blockers)
2. 1.4 → 1.5 → 1.6 (API/edge hardening)
3. 1.7 (CI)
4. 2.1 → 2.2 (one migration)
5. 2.3 (migration)
6. 2.4 → 1.8 (web UI)
7. 1.9 → 1.10 → 2.5 (infra)

---

## Phase 1: Launch blockers

### Overview
Remove the fake-data leak and the gate loophole, add error pages, harden the API and the edge, and stand up CI, error tracking and off-site backups.

### Changes Required:

#### 1.1 Kill the production mock fallback
**File**: `apps/web/lib/data.ts`
- Every `catch → mock` branch falls back only when `process.env.NODE_ENV !== 'production'`. In production it calls `console.error` and rethrows, so the route's `error.tsx` renders.
- Put this in one small helper so the ten getters stay one-liners.
- The mock arrays stay for local dev (per CLAUDE.md).

#### 1.2 Error and 404 pages
**Files**: `apps/web/app/not-found.tsx`, `apps/web/app/error.tsx` (client), `apps/web/app/global-error.tsx`
- Build them from `PageContainer`, `EmptyState` and `Button`, and keep them monochrome.
- `error.tsx` gets a "Try again" button (`reset()`).
- Both error boundaries report to GlitchTip once 1.9 lands.

#### 1.3 Close the give-to-get loophole
**File**: `apps/api/src/users/users.service.ts` (`lastContributionAt`)
- Add `moderationStatus: 'APPROVED'` to the `where`.
- The profile page shows a pending submission as "unlocks once reviewed".
- Update the spec, and add an e2e case to `apps/api/test/moderation.e2e-spec.ts`: a junk submission stays gated, then unlocks after approval.

#### 1.4 API hardening
**Files**: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, a new `apps/api/src/config/env.ts`, the auth DTOs, a new health controller
- **Bootstrap:** add `helmet()` and `enableShutdownHooks()`, set `forbidNonWhitelisted: true`, restrict CORS to `WEB_ORIGIN` (or drop it, since the API is internal-only), and read the port from `PORT ?? 3000`.
- **Env validation:** a zod schema in `ConfigModule.forRoot({ validate })` checks:
  - `DATABASE_URL`
  - `JWT_SECRET` (≥ 32 chars)
  - `JWT_EXPIRES_IN`
  - optional `RESEND_API_KEY`, `TURNSTILE_SECRET`, `SENTRY_DSN`
- **DTOs:** `@MaxLength` on login and register (password ≤ 128, email ≤ 254, name ≤ 120). Audit the remaining string DTO fields for missing limits.
- **Health:** `GET /health` runs `SELECT 1` via Prisma. Repoint the healthcheck in `infra/docker-compose.app.yml:34-40` to it.

#### 1.5 Security headers at the edge
**File**: `infra/nginx/conf.d/capbase.conf`
- Add CSP: `self`, plus GA, Turnstile (`challenges.cloudflare.com`), Clearbit logos and the GlitchTip host.
- Add `frame-ancestors 'none'`, `Permissions-Policy` and HSTS `includeSubDomains`.
- Keep all headers in nginx so they live in one place.

#### 1.6 Rate limiting
**nginx** (`infra/nginx/conf.d/capbase.conf`):
- Add `limit_req_zone $binary_remote_addr` zones:
  - `auth`: ~5r/m, burst 5. Applies to `/api/auth/`, `/api/admin/login`, and POSTs to `/login`, `/register` and `/admin/login` (server actions post to the page path).
  - `general`: ~20r/s, burst 40, on `/`.
- Set `limit_req_status 429`.

**Nest backstop:**
- Add `@nestjs/throttler` globally, with a strict `@Throttle` on `auth/register`, `auth/login` and the contribution POSTs.
- Have `apps/web/lib/api.ts` forward the incoming client IP (`X-Forwarded-For`) on server-side calls.
- Set `trust proxy` in the api so the throttler keys on the real client.

#### 1.7 CI (GitHub Actions)
**File**: `.github/workflows/ci.yml`
- Triggered on PRs and on pushes to `main`.
- Runs `yarn install --frozen-lockfile`, then `yarn build`, `yarn lint`, `yarn workspace api test`, `yarn workspace jobs test` and the `packages/api` tests.
- Runs the api e2e suite against a `postgres:16` service after `prisma migrate deploy`.
- On `main` only, a `docker build` smoke job for the three Dockerfiles.

#### 1.8 Cookie consent for GA
**Files**: `apps/web/app/layout.tsx`, a new `components/ConsentBanner.tsx`
- A minimal monochrome banner built with `Button`, which sets a consent cookie.
- GA's `<Script>` renders only after consent.
- Update the privacy page's cookie section to match.

#### 1.9 Error tracking: self-hosted GlitchTip
- **Compose:** `infra/docker-compose.glitchtip.yml` with GlitchTip web and worker plus `valkey`, and a `mem_limit` on each (~768 MB total on the 8 GB box).
- **Database:** a `glitchtip` database and user on the existing Postgres, created by a new `make deploy-glitchtip-init`.
- **nginx:** a vhost for `errors.capbase.fyi`, with its cert via `deploy-tls`.
- **SDKs** (Sentry protocol), each a no-op when its DSN is unset:
  - `@sentry/nestjs` in api and jobs.
  - `@sentry/nextjs` in web (`instrumentation.ts`, plus capture in `error.tsx` and `global-error.tsx`).
- **Alerts:** GlitchTip email via Resend SMTP.
- **External uptime:** a free UptimeRobot or Better Stack monitor on `https://capbase.fyi` and `/api/health`. GlitchTip can't report its own box being down. Document this in `infra/README.md`.

#### 1.10 Off-site backups (R2/B2)
- Add an `rclone` remote template under `infra/`.
- In `infra/env/*.env`, set `BACKUP_UPLOAD_CMD` to upload the `.age` dump (the hook exists in `scripts/db-backup.sh:86-88`). Retention is ~30 days via a bucket lifecycle rule.
- On a non-zero exit, the backup cron sends a GlitchTip event or an email.
- `deploy-all` takes a pre-migrate backup before recreating the api container.
- Update the restore drill in `infra/README.md` to pull from the bucket.

### Success Criteria:

#### Automated Verification:
- [ ] `yarn build`
- [ ] `make lint`
- [ ] `yarn workspace api test`, `yarn workspace jobs test`
- [ ] api e2e suite passes, including the new give-to-get case
- [ ] CI workflow green on a test PR

#### Manual Verification:
- [ ] With the api stopped, `next build && next start` on `/companies` shows the error page and **no** mock companies. `yarn dev` still shows the mock data.
- [ ] An unknown slug renders the custom 404
- [ ] 20 rapid `POST /api/auth/login` calls start returning 429
- [ ] Booting the api with `JWT_SECRET=short` fails fast with a clear message
- [ ] `curl -I https://capbase.fyi` shows CSP, HSTS and frame-ancestors. The browser console shows no CSP violations (GA, Turnstile, logos).
- [ ] GA requests fire only after the consent banner is accepted
- [ ] A thrown test error appears in GlitchTip from each of web, api and jobs
- [ ] `make deploy-backup` puts an object in the bucket. A restore drill from the bucket succeeds.
- [ ] The external uptime monitor is green and alerts when the api is stopped

---

## Phase 2: Hardening before launch

### Overview
Add account recovery, server-side session control, abuse protection, fast search, a usable mobile nav, and the remaining container and ingest hygiene.

### Changes Required:

#### 2.1 Password reset and session revocation
- **Schema** (`packages/db/prisma/schema.prisma`, one migration together with 2.2):
  - `User.tokenVersion Int @default(0)`
  - `User.bannedAt DateTime?`
  - `PasswordResetToken { id, userId, tokenHash, expiresAt, usedAt, createdAt }`
- **API:**
  - `POST /auth/forgot` always returns 200 and emails a single-use, ~1h link through `MailService`.
  - `POST /auth/reset` uses the token and sets the new password.
  - `POST /auth/me/password` and reset both bump `tokenVersion`.
  - The JWT carries `tokenVersion`.
- **`JwtStrategy.validate`:** loads the user and rejects a user who is missing, banned or has a mismatched `tokenVersion`. **The role comes from the DB row, not the token.**
- **Web:**
  - `(account)/forgot-password` and `(account)/reset-password`, built with RHF and zod (`lib/validation/auth.ts`).
  - A "Forgot password?" link on login.

#### 2.2 Abuse controls
- **Turnstile:**
  - A shared `<TurnstileField>` in `components/ui/` on register and on every contribution form.
  - The token flows through the server action to the API.
  - A `TurnstileGuard` calls `siteverify` and is skipped when `TURNSTILE_SECRET` is unset.
- **Pending cap:** at most ~30 PENDING submissions per user. Above that, contributions return 429.
- **Ban:**
  - `PATCH /admin/users/:id { banned, role }` sets `bannedAt` and bulk-REJECTs that user's PENDING rows.
  - A minimal `/admin/users` page lists and searches users, with ban and role toggles.

#### 2.3 Trigram search indexes
- A migration runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` and adds `GIN (name gin_trgm_ops)` on Company, Investor, Person and Fund, plus `Company.oneLiner`.
- ILIKE uses the index directly, so the query code doesn't change.
- Indexes declared via raw SQL are invisible to Prisma, so check that `prisma migrate dev` does not try to drop them.

#### 2.4 Mobile nav and accessibility
- **`SiteHeader.tsx`:** a small-screen drawer (Radix Dialog / shadcn Sheet, themed monochrome), with `aria-expanded` on the trigger and `aria-current="page"` on the active link.
- **`layout.tsx`:** a skip-to-content link and a single `<main id="content">` wrapper. Remove the per-page `<main>` elements from home, profile, login, register and settings.

#### 2.5 Ops polish
- **Healthchecks:** web gets a `/api/health` route handler. jobs reuses its `/` health endpoint. Add both to compose.
- **Containers:** `USER node` in the three Dockerfiles, and pin `certbot/certbot`.
- **Ingest locking:** wrap scheduled and manual ingest in `pg_try_advisory_lock` (`ingest.scheduler.ts`, `backfill.ts`), and report ingest failures to GlitchTip.
- **Rollback:** tag images with the git SHA in `deploy-all`. Add `make deploy-rollback SHA=…` and document it in `infra/README.md`.

### Success Criteria:

#### Automated Verification:
- [ ] `make db-migrate` applies cleanly; `make db-generate`
- [ ] `yarn build`, `make lint`, `make test`
- [ ] e2e: a reset invalidates the old JWT, a banned user gets 401, and a demoted admin gets 403 on `/admin/*` immediately
- [ ] e2e: contribution beyond the pending cap returns 429

#### Manual Verification:
- [ ] Forgot → email link (logged when Resend is a no-op) → reset → log in with the new password
- [ ] Turnstile renders on register and on the contribution forms. A missing token is rejected when `TURNSTILE_SECRET` is set.
- [ ] `EXPLAIN ANALYZE` of a directory search shows a Bitmap Index Scan on the trigram index
- [ ] At 375px the drawer opens and closes and works with the keyboard. Tab shows the skip link first.
- [ ] `docker compose ps` shows every service healthy, and the containers run as non-root
- [ ] Running a manual ingest during the cron run skips with a "lock held" log
- [ ] `make deploy-rollback SHA=<previous>` restores the previous images
- [ ] `make deploy-doctor` passes on the VPS

---

## Progress & deviations (2026-10-02)

Done on branch `feat/production-readiness` (uncommitted):
- **1.1 mock fallback**: gated by `allowMockFallback` in `lib/data.ts`. A 404 still maps to `notFound()` in every mode. Verified with `next start` and the API down: error page, no mock data.
- **1.2 error pages**: `not-found.tsx`, `error.tsx`, `global-error.tsx`, checked in headless Chrome.
- **1.3 give-to-get**: APPROVED-only. Copy in CompanyForm, the contribute page, the company page and the profile now says "approved". The profile shows a pending-review state. Covered by unit and e2e tests.
- **1.4 API hardening**:
  - helmet, shutdown hooks, `PORT` env, opt-in `CORS_ORIGIN`.
  - `validateEnv` (secret strength enforced only in production, so `.env.example` keeps working).
  - DB-backed `GET /health`, now used by both compose healthchecks.
  - `MaxLength`/`ArrayMaxSize` on every auth and contribution DTO.
- **1.5 headers**: nginx sends HSTS `includeSubDomains`, Permissions-Policy and an enforced CSP subset (frame-ancestors/object-src/base-uri/form-action). The full allowlist is **Report-Only**.
- **1.6 rate limiting**: nginx zones `auth` (10r/m), `writes` (POST, 30r/m) and `general` (30r/s). Verified with `nginx -t` and a functional 429 test.
- **1.7 CI**: `.github/workflows/ci.yml` (build, lint, unit, e2e on a Postgres service, Docker build on push). Passes actionlint.
- **2.1 password reset and revocation**:
  - Migration `auth_hardening` adds `tokenVersion`, `bannedAt` and `PasswordResetToken`.
  - The JWT strategy re-reads the user, so role, ban and tokenVersion come from the DB. A token without `tv` counts as version 0, so the deploy doesn't sign anyone out.
  - Endpoints `/auth/forgot-password` and `/auth/reset-password`. Change-password returns a fresh token.
  - Web pages `/forgot-password` and `/reset-password`, plus the login link.
  - Covered by unit tests, e2e (`test/auth.e2e-spec.ts`) and a Playwright run of the full flow.

Deviations from the plan:
- **No Nest `@nestjs/throttler` backstop.** The API only ever sees the web container's IP, so a Nest limit would throttle all users as one client. Forwarding the client IP means calling `headers()` inside `apiFetch`, which would make every ISR-cached read dynamic. nginx is the single limiter, and the API is not publicly exposed.
- **No `forbidNonWhitelisted`.** `whitelist` already strips unknown fields. Rejecting them could break existing forms that send extra keys, for no security gain.
- **CSP fetch allowlist is Report-Only** until checked on prod. Next's inline bootstrap needs `'unsafe-inline'` without nonces.
- **Bug found and fixed:** on `/register` (and the new reset form), fixing a "passwords do not match" error left the message up until blur, so the first submit click missed the shifting button. Both forms now use `mode: 'onTouched'`.

Remaining:
- 2.2 (Turnstile, pending cap, ban/role admin page)
- 2.3 (trigram)
- 2.4 (mobile nav, a11y)
- 1.8 (consent)
- 1.9 (GlitchTip)
- 1.10 (off-site backups)
- 2.5 (ops polish)

## References
- Audits run 2026-10-01: security/auth, ops/infra/CI, product completeness
- Runbook: `infra/README.md`
- Rebuild: `docs/DATA_REBUILD.md`
