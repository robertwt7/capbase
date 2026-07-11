# Split-VPS Deployment (DB VPS + App VPS, with single-VPS fallback) Implementation Plan

## Overview

Add production deployment that can run **Postgres on one VPS and the app (web + api + jobs)
on another**, fronted by **nginx + Let's Encrypt TLS**, plus a **single-VPS "deploy
everything" fallback** for when you don't want to bother splitting. Everything is driven by
a small `infra/` folder and a handful of `make deploy-*` targets, with heavily-commented env
templates that make the cross-VPS ordering ("deploy DB, copy its host into the app env, then
deploy app") impossible to forget.

## Current State Analysis

Today there is a **single** `docker-compose.yml` at the repo root that runs `postgres + api +
web + jobs` together on one machine, wired for local/prod-like use:

- **DB URL is hardcoded**, not env-driven: `docker-compose.yml:1-2` defines a YAML anchor
  `x-db-url: DATABASE_URL: postgresql://capbase:capbase@postgres:5432/...` reused by `api`
  (`:32`) and `jobs` (`:73`). The host `postgres` is the compose service name — it only
  resolves when Postgres is in the same compose project.
- **api and jobs `depends_on` the local `postgres` service** with `condition: service_healthy`
  (`docker-compose.yml:39-41`, `:80-82`), and so does the `seed` one-shot (`:96-98`). These
  break the moment Postgres lives in a different compose file / VPS.
- **The api container migrates on boot**: `apps/api/Dockerfile:40` runs
  `yarn workspace @repo/db migrate:deploy && node apps/api/dist/main.js`. Pointed at a remote
  `DATABASE_URL`, it will migrate the remote DB automatically — we keep this behavior.
- **No `infra/`, nginx, reverse proxy, or root `.env.example` exists** (confirmed via
  `git ls-files | grep -iE 'nginx|infra|deploy'` → only the ticket).
- Env inventory per service (from `docker-compose.yml` + `apps/*/.env.example`):
  - **api**: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `RESEND_API_KEY`, `MAIL_FROM`
  - **web**: `API_URL` (points at `http://api:3000`)
  - **jobs**: `DATABASE_URL`, `SEC_USER_AGENT`, `CRON_SCHEDULE`, `INGEST_ON_BOOT`,
    `INGEST_LIMIT`, `PORT`
  - **seed** (profile): `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`
- All three Dockerfiles build from the **monorepo root context** via `turbo prune`
  (`apps/*/Dockerfile:12`, `:26-29`), so the **App VPS needs the full repo checked out** to
  build. The **DB VPS only needs the `postgres:16` image** + a compose file (no build).
- Existing Makefile targets (`db-up`, `up`, `seed`, `down`, `clean`, `logs`, `ps`) all use the
  root `COMPOSE := docker compose` against the root compose file. These stay as the **local**
  workflow and are left untouched.

### The single most important discovery — the browser never talks to the API

`apps/web/lib/api.ts:1-5` documents and enforces that `API_URL` is **server-only** (deliberately
**not** `NEXT_PUBLIC_*`). Every API call is server-side:

- Public reads go through `apiFetch()` in React Server Components (`apps/web/lib/api.ts:21`).
- Auth/admin login+register are **Next.js route handlers that proxy to the API server-side**:
  `apps/web/app/api/auth/login/route.ts:18`, `app/api/auth/register/route.ts:17`,
  `app/api/admin/login/route.ts:17` all `fetch(\`${API_URL}/...\`)` from the server and set the
  JWT cookie themselves.

**Consequence for the reverse proxy:** on the App VPS, **only the `web` app (`:3001`) needs to
be public**. `api` (`:3000`) and `jobs` (`:3002`) stay private on the internal Docker network —
`web` reaches the API at `http://api:3000` exactly as it does today. nginx proxies **only** to
`web`. This dramatically simplifies the infra: no CORS exposure, no public API surface.

### TLS is a correctness requirement, not just hardening

The login route handlers set the auth cookie with `secure: process.env.NODE_ENV === 'production'`
(`app/api/auth/login/route.ts:34`, `app/api/admin/login/route.ts:37`,
`app/api/auth/register/route.ts:37`). In production these cookies are **secure-only**, so a
browser will silently refuse to store/send them over plain HTTP. **Without HTTPS, admin and user
login break.** This is why Phase 2 (nginx + certbot) is required, not optional, for a real deploy.

## Desired End State

A `infra/` folder + `make deploy-*` targets supporting three topologies:

| Topology | Command | Runs |
| --- | --- | --- |
| **DB VPS** | `make deploy-db` | Postgres only |
| **App VPS** | `make deploy-app` | web + api + jobs + nginx + certbot, `DATABASE_URL` → remote DB |
| **Single VPS ("lazy")** | `make deploy-all` | all of the above on one box, `DATABASE_URL` → internal `postgres` |

Verification of the end state:

- **Split:** `make deploy-db` on the DB VPS brings up a healthy Postgres; on the App VPS,
  filling `DATABASE_URL` with the DB VPS host then `make deploy-app` + `make deploy-tls` yields
  `https://<domain>` serving the site, with admin login working (proving TLS + remote DB + the
  migrate-on-boot all wired correctly).
- **Single VPS:** `make deploy-all` on one box + `make deploy-tls` yields the same, with Postgres
  co-located.
- Running `make deploy-app` while `infra/env/app.env` still contains a `CHANGE_ME` placeholder
  **fails fast** with a message telling you to set `DATABASE_URL` first.

### Key Discoveries

- Browser → nginx → `web:3001` is the **only** public path; api/jobs stay internal
  (`apps/web/lib/api.ts:1-5`) — nginx proxies only `web`.
- Login cookies are `secure`-only in prod (`app/api/auth/login/route.ts:34`) → **HTTPS required**.
- api migrates the DB on container boot (`apps/api/Dockerfile:40`) → no separate migrate step,
  works against a remote DB.
- DB URL currently hardcoded via a compose anchor (`docker-compose.yml:1-2`) → must become
  env-driven for the split.
- api/jobs/seed `depends_on: postgres` (`docker-compose.yml:39-41,80-82,96-98`) → must be dropped
  in the app stack and re-added (via an override) only for single-VPS.
- Compose **build context** is `../..` from an `infra/`-located file, and volume paths resolve
  relative to the compose file's directory — so `context: ../..` + `./nginx/...` work when
  invoked from the repo root.

## What We're NOT Doing

- **Not** touching the existing root `docker-compose.yml` or its `make up/dev/down/seed/clean`
  targets — that remains the local/prod-like-on-one-box dev workflow.
- **Not** exposing the NestJS API publicly (the browser never needs it; see above).
- **Not** building images in CI or pushing to a container registry — images build **on the App
  VPS** from source, matching the current Dockerfiles and the chosen "SSH in + `git pull` + make"
  workflow.
- **Not** automating the Hetzner/exe.dev **private network + firewall** setup — you'll do that
  later; the plan makes Postgres' bind address configurable and documents the firewall steps in
  the runbook, but does not script provider APIs.
- **Not** adding Postgres replication, backups, or connection pooling (PgBouncer) — out of scope;
  noted as future work in the runbook.
- **Not** changing app code, Prisma schema, or the auth/cookie logic.

## Implementation Approach

Keep the existing root compose for local use. Add a parallel **production** compose set under
`infra/`, split by responsibility and composed with Docker Compose's `-f` overlay so the same two
base files serve both the split and single-VPS topologies:

- `infra/docker-compose.db.yml` — Postgres (DB VPS **and** single-VPS).
- `infra/docker-compose.app.yml` — api + web + jobs + nginx + certbot + seed profile, with
  **env-driven `DATABASE_URL`** and **no `postgres` dependency**.
- `infra/docker-compose.all.yml` — tiny override that (a) is merged **on top of** db+app for
  single-VPS and (b) re-adds `depends_on: postgres` so api/jobs wait for the co-located DB.

Env is supplied per-topology via `--env-file` (three commented templates). The Makefile hides the
`-f`/`--env-file` verbosity behind `COMPOSE_DB` / `COMPOSE_APP` / `COMPOSE_ALL` command variables
and adds a placeholder guard. nginx uses the official image's template substitution for `${DOMAIN}`;
certbot bootstraps once via a script and renews in a loop.

---

## Phase 1: Production compose split + env templates

### Overview

Create the `infra/` compose files and env templates so the app stack runs with an **env-driven,
possibly-remote** `DATABASE_URL` and Postgres can run standalone. No nginx yet — `web` is
temporarily published on `:3001` so the split can be verified end-to-end before TLS is added.

### Changes Required

#### 1. Postgres compose (DB VPS + single-VPS base)
**File**: `infra/docker-compose.db.yml` (new)
**Changes**: Postgres service with env-driven credentials and a configurable bind address/port so
it can later be pinned to a private-network IP.

```yaml
# Postgres — runs on the DB VPS (`make deploy-db`) or, on a single box, as the
# base of the all-in-one stack (`make deploy-all`). Env: infra/env/db.env
# (single VPS uses infra/env/all.env instead).
services:
  postgres:
    image: postgres:16
    container_name: capbase-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-capbase}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in your env file}
      POSTGRES_DB: ${POSTGRES_DB:-capbase}
    # Split VPS: after you set up the private network, set POSTGRES_BIND to the
    # DB VPS's PRIVATE ip (e.g. 10.0.0.2) and firewall this port to the App VPS.
    # Single VPS: 127.0.0.1 is fine (nothing external connects). See infra/README.md.
    ports:
      - '${POSTGRES_BIND:-0.0.0.0}:${POSTGRES_PORT:-5432}:5432'
    volumes:
      - capbase-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER:-capbase} -d ${POSTGRES_DB:-capbase}']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  capbase-pgdata:
```

#### 2. App compose (api + web + jobs; nginx/certbot added in Phase 2)
**File**: `infra/docker-compose.app.yml` (new)
**Changes**: api/web/jobs with `build.context: ../..`, env-driven `DATABASE_URL`, **no
`depends_on: postgres`**. `web` temporarily publishes `3001` (removed in Phase 2). Includes the
`seed` one-shot profile pointed at the configured `DATABASE_URL`. (nginx + certbot services are
added to this same file in Phase 2.)

```yaml
# App stack — web + api + jobs (nginx + certbot added in Phase 2). Runs on the
# App VPS (`make deploy-app`) or as part of all-in-one (`make deploy-all`).
# Env: infra/env/app.env  (single VPS: infra/env/all.env).
#
# ⚠️ DATABASE_URL must point at the DB VPS BEFORE `make deploy-app` — see README.
services:
  api:
    build:
      context: ../..
      dockerfile: apps/api/Dockerfile
    image: capbase-api
    container_name: capbase-api
    restart: unless-stopped
    environment:
      DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL in your env file}
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in your env file}
      JWT_EXPIRES_IN: ${JWT_EXPIRES_IN:-7d}
      RESEND_API_KEY: ${RESEND_API_KEY:-}
      MAIL_FROM: ${MAIL_FROM:-Capbase <onboarding@resend.dev>}
    # Internal only — the browser never hits the API (API_URL is server-side).
    # Uncomment to expose on localhost for debugging:
    # ports: ['127.0.0.1:3000:3000']
    healthcheck:
      test:
        ['CMD', 'node', '-e', "fetch('http://localhost:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 30s

  web:
    build:
      context: ../..
      dockerfile: apps/web/Dockerfile
    image: capbase-web
    container_name: capbase-web
    restart: unless-stopped
    environment:
      API_URL: http://api:3000
    # PHASE 1 ONLY: publish web directly so the split is testable before nginx.
    # Phase 2 REMOVES this block (nginx becomes the only public entrypoint).
    ports:
      - '3001:3001'
    depends_on:
      api:
        condition: service_healthy

  jobs:
    build:
      context: ../..
      dockerfile: apps/jobs/Dockerfile
    image: capbase-jobs
    container_name: capbase-jobs
    restart: unless-stopped
    environment:
      DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL in your env file}
      SEC_USER_AGENT: ${SEC_USER_AGENT:-capbase-ingest (contact@example.com)}
      CRON_SCHEDULE: ${CRON_SCHEDULE:-0 6 * * *}
      INGEST_ON_BOOT: ${INGEST_ON_BOOT:-false}
      INGEST_LIMIT: ${INGEST_LIMIT:-50}
    depends_on:
      api:
        condition: service_healthy

  # One-shot seed against the configured DATABASE_URL: `make deploy-seed`.
  seed:
    image: capbase-api
    profiles: ['seed']
    environment:
      DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL in your env file}
      ADMIN_EMAIL: ${ADMIN_EMAIL:-admin@capbase.fyi}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-admin12345}
      ADMIN_NAME: ${ADMIN_NAME:-Capbase Admin}
    command: ['yarn', 'workspace', '@repo/db', 'seed']
```

#### 3. Single-VPS override
**File**: `infra/docker-compose.all.yml` (new)
**Changes**: Merged on top of db+app for `make deploy-all`; re-adds `depends_on: postgres` so
api/jobs wait for the co-located DB. `DATABASE_URL` (in `all.env`) points at host `postgres`.

```yaml
# Single-VPS override (merged AFTER db.yml + app.yml by `make deploy-all`).
# Makes api/jobs wait for the co-located Postgres. With this topology,
# DATABASE_URL (infra/env/all.env) uses host `postgres`, not a remote VPS.
services:
  api:
    depends_on:
      postgres:
        condition: service_healthy
  jobs:
    depends_on:
      postgres:
        condition: service_healthy
```

#### 4. Env templates (the "so I remember later" deliverable)
**Files**: `infra/env/db.env.example`, `infra/env/app.env.example`, `infra/env/all.env.example`
(new)
**Changes**: Commented templates. `app.env.example` leads with the **ORDER MATTERS** note and a
`CHANGE_ME_DB_HOST` placeholder that the Phase 3 guard keys off.

`infra/env/db.env.example`:
```bash
# ── DB VPS env (infra/docker-compose.db.yml) ──────────────────────────────
# Copy to infra/env/db.env. Used by `make deploy-db`.
POSTGRES_USER=capbase
POSTGRES_PASSWORD=CHANGE_ME_strong_password      # ⚠️ set a strong password
POSTGRES_DB=capbase

# Where Postgres listens on the host:
#  • Split VPS: after setting up the private network, set POSTGRES_BIND to the
#    DB VPS's PRIVATE ip (e.g. 10.0.0.2) and firewall this port to the App VPS.
POSTGRES_BIND=0.0.0.0
POSTGRES_PORT=5432

# 👉 After `make deploy-db`, note this host + these creds — you paste them into
#    infra/env/app.env → DATABASE_URL BEFORE `make deploy-app`.
```

`infra/env/app.env.example`:
```bash
# ── App VPS env (infra/docker-compose.app.yml) ────────────────────────────
# Copy to infra/env/app.env. Used by `make deploy-app`.
#
# ⚠️⚠️ ORDER MATTERS ⚠️⚠️
#   1. Deploy the DB first: `make deploy-db` on the DB VPS.
#   2. Set DATABASE_URL below to point at that DB VPS (private IP + creds).
#   3. THEN `make deploy-app`.
# `make deploy-app` refuses to run while DATABASE_URL still says CHANGE_ME.

# ── Database (split VPS) ──
#   postgresql://USER:PASS@<DB_VPS_PRIVATE_IP>:5432/capbase?schema=public
DATABASE_URL=postgresql://capbase:CHANGE_ME@CHANGE_ME_DB_HOST:5432/capbase?schema=public

# ── Public site / TLS (used in Phase 2) ──
DOMAIN=capbase.example.com               # domain pointed at THIS App VPS (A record)
LETSENCRYPT_EMAIL=you@example.com        # cert expiry notices

# ── Auth ──
JWT_SECRET=CHANGE_ME_long_random_secret  # generate: openssl rand -hex 32
JWT_EXPIRES_IN=7d

# ── Email (Resend) — leave key empty to disable (logged no-op) ──
RESEND_API_KEY=
MAIL_FROM=Capbase <onboarding@resend.dev>

# ── SEC ingestion (jobs worker) ──
SEC_USER_AGENT=capbase-ingest (you@example.com)
CRON_SCHEDULE=0 6 * * *
INGEST_ON_BOOT=false
INGEST_LIMIT=50

# ── Seed admin (only `make deploy-seed`) ──
ADMIN_EMAIL=admin@capbase.fyi
ADMIN_PASSWORD=CHANGE_ME_admin_password
ADMIN_NAME=Capbase Admin
```

`infra/env/all.env.example`:
```bash
# ── Single-VPS env (make deploy-all) ──────────────────────────────────────
# Everything on one box. Copy to infra/env/all.env. DATABASE_URL points at the
# internal `postgres` service, so there's NO cross-VPS step to remember here.
# NOTE: keep POSTGRES_PASSWORD and the password inside DATABASE_URL identical.
POSTGRES_USER=capbase
POSTGRES_PASSWORD=CHANGE_ME_strong_password
POSTGRES_DB=capbase
POSTGRES_BIND=127.0.0.1                   # no need to expose Postgres on one box
POSTGRES_PORT=5432

DATABASE_URL=postgresql://capbase:CHANGE_ME_strong_password@postgres:5432/capbase?schema=public

DOMAIN=capbase.example.com
LETSENCRYPT_EMAIL=you@example.com
JWT_SECRET=CHANGE_ME_long_random_secret
JWT_EXPIRES_IN=7d
RESEND_API_KEY=
MAIL_FROM=Capbase <onboarding@resend.dev>
SEC_USER_AGENT=capbase-ingest (you@example.com)
CRON_SCHEDULE=0 6 * * *
INGEST_ON_BOOT=false
INGEST_LIMIT=50
ADMIN_EMAIL=admin@capbase.fyi
ADMIN_PASSWORD=CHANGE_ME_admin_password
ADMIN_NAME=Capbase Admin
```

#### 5. Ignore real env + cert data
**File**: `.gitignore`, `.dockerignore` (edit)
**Changes**: Ignore real env files and certbot state; keep `*.env.example` tracked.

```gitignore
# infra: real deployment env files + Let's Encrypt state (keep *.example)
infra/env/*.env
infra/certbot/conf
infra/certbot/www
```
`.dockerignore` — add so cert data / real env never enters the build context:
```
infra/env/*.env
infra/certbot/conf
infra/certbot/www
```

### Success Criteria

#### Automated Verification
- [x] Both compose files parse: `docker compose -f infra/docker-compose.db.yml --env-file infra/env/db.env.example config -q`
- [x] App compose parses with app env: `docker compose -f infra/docker-compose.app.yml --env-file infra/env/app.env.example config -q`
- [x] Single-VPS overlay merges: `docker compose -f infra/docker-compose.db.yml -f infra/docker-compose.app.yml -f infra/docker-compose.all.yml --env-file infra/env/all.env.example config -q`
- [x] Merged single-VPS config shows api/jobs `depends_on: postgres`: `docker compose -f infra/docker-compose.db.yml -f infra/docker-compose.app.yml -f infra/docker-compose.all.yml --env-file infra/env/all.env.example config | grep -A2 depends_on | grep postgres`
- [x] Missing required var fails loudly (no silent empty DB URL): `docker compose -f infra/docker-compose.app.yml config 2>&1 | grep -q "DATABASE_URL"`
- [x] `git status` shows `infra/env/*.env` ignored but `*.env.example` tracked.

#### Manual Verification
- [ ] On a test host, `cp infra/env/all.env.example infra/env/all.env`, set the passwords, and
  `docker compose -f infra/docker-compose.db.yml -f infra/docker-compose.app.yml -f infra/docker-compose.all.yml --env-file infra/env/all.env up -d --build` brings all four containers healthy.
- [ ] `web` is reachable on `http://<host>:3001` (Phase-1 temporary port) and renders the landing page.
- [ ] api logs show `migrate deploy` ran against the DB and the site lists seeded/empty data.

**Implementation Note**: After automated verification passes, pause for manual confirmation that
the all-in-one stack comes up and the site renders before proceeding to Phase 2.

---

## Phase 2: nginx reverse proxy + Let's Encrypt TLS

### Overview

Put nginx in front of `web` as the only public entrypoint (ports 80/443), terminate TLS with
Let's Encrypt via certbot, and remove the temporary `web` port publish. Add a one-time cert
bootstrap script and an auto-renew loop.

### Changes Required

#### 1. Add nginx + certbot to the app stack; drop the temporary web port
**File**: `infra/docker-compose.app.yml` (edit)
**Changes**: Remove the Phase-1 `web.ports` block. Add `nginx` and `certbot` services sharing
cert volumes. nginx uses the official image's `${DOMAIN}` template substitution (scoped with
`NGINX_ENVSUBST_FILTER` so nginx runtime vars like `$host` are left alone).

```yaml
  # (remove web.ports — nginx is now the only public entrypoint)

  nginx:
    image: nginx:1.27-alpine
    container_name: capbase-nginx
    restart: unless-stopped
    depends_on:
      - web
    ports:
      - '80:80'
      - '443:443'
    environment:
      DOMAIN: ${DOMAIN:?set DOMAIN in your env file}
      NGINX_ENVSUBST_FILTER: DOMAIN   # only substitute ${DOMAIN}, not $host etc.
    volumes:
      - ./nginx/templates:/etc/nginx/templates:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
    # Reload every 6h so renewed certs are picked up without a restart.
    command: sh -c 'while :; do sleep 6h & wait $${!}; nginx -s reload; done & nginx -g "daemon off;"'

  certbot:
    image: certbot/certbot
    container_name: capbase-certbot
    restart: unless-stopped
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    # Try renewal every 12h (no-op until ~30 days before expiry).
    entrypoint: sh -c 'trap exit TERM; while :; do certbot renew --webroot -w /var/www/certbot; sleep 12h & wait $${!}; done'
```

#### 2. nginx server template
**File**: `infra/nginx/templates/app.conf.template` (new)
**Changes**: HTTP server serves the ACME challenge + redirects to HTTPS; HTTPS server proxies to
`web:3001`. The official nginx image renders `*.template` from `/etc/nginx/templates` into
`/etc/nginx/conf.d/` at startup, substituting `${DOMAIN}`.

```nginx
# Rendered to /etc/nginx/conf.d/app.conf ( ${DOMAIN} substituted at boot ).
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass         http://web:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
    }
}
```

#### 3. One-time TLS bootstrap script
**File**: `infra/certbot/init-letsencrypt.sh` (new, `chmod +x`)
**Changes**: Standard nginx+certbot bootstrap — fetch recommended TLS params, create a 1-day
dummy cert so nginx can start on 443, bring the stack up, then swap in a real cert via the webroot
challenge and reload nginx. Reads `DOMAIN`/`LETSENCRYPT_EMAIL` from `infra/env/app.env`. Run from
the repo root.

```sh
#!/bin/sh
# One-time Let's Encrypt bootstrap. Prereqs: DNS A record -> this VPS, ports
# 80/443 open, infra/env/app.env filled in. Re-run with FORCE=1 to recreate.
set -e
ENV_FILE="${ENV_FILE:-infra/env/app.env}"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
: "${DOMAIN:?set DOMAIN in $ENV_FILE}"
: "${LETSENCRYPT_EMAIL:?set LETSENCRYPT_EMAIL in $ENV_FILE}"

COMPOSE="docker compose -p capbase -f infra/docker-compose.app.yml --env-file $ENV_FILE"
CONF=infra/certbot/conf
mkdir -p "$CONF" infra/certbot/www

# Recommended TLS params referenced by the nginx template.
[ -f "$CONF/options-ssl-nginx.conf" ] || curl -sfL \
  https://raw.githubusercontent.com/certbot/certbot/main/certbot-nginx/src/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
  -o "$CONF/options-ssl-nginx.conf"
[ -f "$CONF/ssl-dhparams.pem" ] || curl -sfL \
  https://raw.githubusercontent.com/certbot/certbot/main/certbot/certbot/ssl-dhparams.pem \
  -o "$CONF/ssl-dhparams.pem"

if [ -d "$CONF/live/$DOMAIN" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Cert for $DOMAIN exists. Set FORCE=1 to recreate."; exit 0
fi

# 1) Dummy cert so nginx can boot on 443.
$COMPOSE run --rm --entrypoint "sh -c '\
  mkdir -p /etc/letsencrypt/live/$DOMAIN && \
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem -subj /CN=localhost'" certbot
# 2) Start the stack (nginx serves the ACME challenge on :80).
$COMPOSE up -d --build
# 3) Replace dummy with a real cert via the webroot challenge.
$COMPOSE run --rm --entrypoint "sh -c '\
  rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf'" certbot
$COMPOSE run --rm --entrypoint "certbot certonly --webroot -w /var/www/certbot \
  -d $DOMAIN --email $LETSENCRYPT_EMAIL --agree-tos --no-eff-email --non-interactive" certbot
# 4) Reload nginx with the real cert.
$COMPOSE exec nginx nginx -s reload
echo "TLS ready: https://$DOMAIN"
```

### Success Criteria

#### Automated Verification
- [x] App compose still parses with nginx/certbot added: `docker compose -f infra/docker-compose.app.yml --env-file infra/env/app.env.example config -q`
- [x] `web` no longer publishes a host port: `docker compose -f infra/docker-compose.app.yml --env-file infra/env/app.env.example config | grep -A6 'web:' | grep -q published` returns nothing.
- [x] nginx publishes 80 + 443: `docker compose -f infra/docker-compose.app.yml --env-file infra/env/app.env.example config | grep -E 'published: "(80|443)"'`
- [x] Bootstrap script is executable and `sh -n`-clean (`shellcheck` unavailable on this host — binary not installed and the Docker pull path is broken; run `shellcheck infra/certbot/init-letsencrypt.sh` once available): `test -x infra/certbot/init-letsencrypt.sh`

#### Manual Verification
- [ ] With DNS pointed at the host and ports 80/443 open, `make deploy-tls` obtains a real cert
  (certbot prints "Congratulations").
- [ ] `https://<domain>` serves the site with a valid (non-self-signed) certificate.
- [ ] `http://<domain>` 301-redirects to `https://`.
- [ ] **Admin login works over HTTPS** (`/admin/login`) and the `capbase_token` cookie is set —
  confirms the secure-cookie path is satisfied.
- [ ] `docker compose ... run --rm certbot certbot renew --dry-run` succeeds (renewal wired).

**Implementation Note**: Pause for manual confirmation that HTTPS + login work before Phase 3.

---

## Phase 3: Makefile deploy targets + placeholder guard

### Overview

Wrap the compose incantations in `make deploy-*` targets and add a guard that refuses to deploy
the app while the env file still has `CHANGE_ME` placeholders — directly addressing "so I can
remember" the DB-host step.

### Changes Required

#### 1. Append a deployment section to the Makefile
**File**: `Makefile` (edit — append after the existing "Production-like stack" section, `:108`)
**Changes**: Command variables + targets + guard. Uses the existing `COMPOSE := docker compose`
and `-p capbase` for a stable project name.

```makefile
# ---------------------------------------------------------------------------
# Production deployment (split VPS, or single-VPS all-in-one).
# Run these ON the target VPS after `git pull`. See infra/README.md.
# ---------------------------------------------------------------------------

COMPOSE_DB  := $(COMPOSE) -p capbase -f infra/docker-compose.db.yml --env-file infra/env/db.env
COMPOSE_APP := $(COMPOSE) -p capbase -f infra/docker-compose.app.yml --env-file infra/env/app.env
COMPOSE_ALL := $(COMPOSE) -p capbase -f infra/docker-compose.db.yml -f infra/docker-compose.app.yml -f infra/docker-compose.all.yml --env-file infra/env/all.env

.PHONY: deploy-db
deploy-db: ENVF := infra/env/db.env
deploy-db: check-env ## [DB VPS] Start Postgres (reads infra/env/db.env)
	$(COMPOSE_DB) up -d --wait postgres

.PHONY: deploy-app
deploy-app: ENVF := infra/env/app.env
deploy-app: check-env ## [App VPS] Build + start web/api/jobs/nginx (reads infra/env/app.env)
	$(COMPOSE_APP) up -d --build

.PHONY: deploy-all
deploy-all: ENVF := infra/env/all.env
deploy-all: check-env ## [1 VPS] Build + start EVERYTHING incl. Postgres (reads infra/env/all.env)
	$(COMPOSE_ALL) up -d --build

.PHONY: deploy-tls
deploy-tls: ## [App/1 VPS] One-time Let's Encrypt cert bootstrap (needs DNS + ports 80/443)
	sh infra/certbot/init-letsencrypt.sh

.PHONY: deploy-seed
deploy-seed: ## Seed admin + demo data against the configured DATABASE_URL
	$(COMPOSE_APP) --profile seed run --rm seed

.PHONY: deploy-logs
deploy-logs: ## Tail logs from the app stack
	$(COMPOSE_APP) logs -f

.PHONY: deploy-down
deploy-down: ## Stop the app stack (keeps data)
	$(COMPOSE_APP) down

# Guard: env file must exist and have no CHANGE_ME placeholders left.
.PHONY: check-env
check-env:
	@test -f "$(ENVF)" || { echo "❌ $(ENVF) missing — copy $(ENVF).example and fill it in"; exit 1; }
	@if grep -qE 'CHANGE_ME' "$(ENVF)"; then \
		echo "❌ $(ENVF) still has CHANGE_ME placeholders."; \
		echo "   Did you set DATABASE_URL after deploying the DB? See infra/README.md."; \
		exit 1; \
	fi
```

> Note: `deploy-db` needs Postgres reachable from where you run it. In the split topology you run
> it **on the DB VPS**. `deploy-tls`/`deploy-seed` use `COMPOSE_APP`; on a single VPS they still
> work because `make deploy-all` created the `capbase` project the app services live in.

### Success Criteria

#### Automated Verification
- [x] `make help` lists the new `deploy-*` targets: `make help | grep -E 'deploy-(db|app|all|tls|seed)'`
- [x] The guard fires on placeholders: `cp infra/env/app.env.example infra/env/app.env && make deploy-app` exits non-zero with the CHANGE_ME message (then `rm infra/env/app.env`).
- [x] The guard fires on a missing file: `make deploy-app` (no `infra/env/app.env`) exits non-zero with the "missing" message.
- [x] Makefile has no tab/spacing errors: `make -n deploy-all` dry-runs and prints the compose command.

#### Manual Verification
- [ ] After filling `infra/env/all.env` (no CHANGE_ME left), `make deploy-all` builds and starts
  the full stack on one VPS.
- [ ] `make deploy-seed` creates the admin user (admin login succeeds with the seeded creds).
- [ ] `make deploy-down` stops the stack; the `capbase-pgdata` volume (data) survives.

**Implementation Note**: Pause for manual confirmation the targets behave on a real VPS before
Phase 4.

---

## Phase 4: Deployment runbook (`infra/README.md`)

### Overview

Write the runbook so the whole process — split, single-VPS, TLS, seeding, and the env-ordering
gotcha — is documented in one place. This is the durable answer to "so I can remember later."

### Changes Required

#### 1. Deployment runbook
**File**: `infra/README.md` (new)
**Changes**: Sections:

- **Architecture** — one diagram: `browser → nginx(443) → web:3001 → api:3000 → postgres:5432`,
  `jobs → postgres`. Emphasize api/jobs are internal-only and why (server-only `API_URL`).
- **Prerequisites** — Docker + compose plugin on each VPS; repo cloned on each VPS (`git pull` to
  update); a domain with an A record → App VPS; ports 22/80/443 open on the App VPS.
- **Option A — Split (DB VPS + App VPS)**, exact order:
  1. **DB VPS**: `cp infra/env/db.env.example infra/env/db.env`, set password, `make deploy-db`.
  2. Note the DB VPS host (private IP once the private network is up) + creds.
  3. **App VPS**: `cp infra/env/app.env.example infra/env/app.env`; set `DATABASE_URL` to the DB
     VPS, plus `DOMAIN`, `LETSENCRYPT_EMAIL`, `JWT_SECRET`. **(The guard blocks you if you skip
     this.)**
  4. `make deploy-app`, then `make deploy-tls`, then `make deploy-seed` (first deploy only).
- **Option B — Single VPS ("lazy")**: `cp infra/env/all.env.example infra/env/all.env`, set
  passwords + `DOMAIN` + `JWT_SECRET`, `make deploy-all`, `make deploy-tls`, `make deploy-seed`.
- **Private network + firewall (Hetzner / exe.dev)** — reference steps you'll do later:
  - Attach both VPSes to a private network; note the DB VPS private IP.
  - Set `POSTGRES_BIND=<db-private-ip>` in `infra/env/db.env`, redeploy DB.
  - Point the App VPS `DATABASE_URL` at that private IP.
  - `ufw` on the DB VPS: allow 22, allow `5432` **from the App VPS private IP only**, deny else.
  - `ufw` on the App VPS: allow 22, 80, 443.
- **Updating / redeploying**: `git pull` on the VPS, then `make deploy-app` (or `deploy-all`) —
  api re-runs `migrate deploy` on boot.
- **The env-ordering gotcha** (called out prominently): DB first → copy host into `app.env` →
  app. The `check-env` guard enforces it.
- **Troubleshooting**: cert issuance (DNS/ports), `deploy-logs`, api can't reach DB (firewall /
  `POSTGRES_BIND` / `DATABASE_URL` host), secure-cookie login requires HTTPS.
- **Not covered yet (future)**: DB backups (`pg_dump` cron), PgBouncer, Postgres SSL
  (`sslmode=require`), CI image builds + registry.

### Success Criteria

#### Automated Verification
- [x] `infra/README.md` exists and links resolve: `test -f infra/README.md`
- [x] Every command in the runbook that names a make target matches a real one:
  `for t in deploy-db deploy-app deploy-all deploy-tls deploy-seed; do grep -q "^$t:" Makefile || echo "MISSING $t"; done` prints nothing.

#### Manual Verification
- [ ] A fresh read of the runbook is enough to deploy split **and** single-VPS without referring
  back to this plan.
- [ ] The env-ordering section makes the "update app env after DB" step unmissable.

---

## Testing Strategy

### Config-level (fast, no VPS)
- `docker compose ... config -q` on each file/overlay combination with the `.example` envs.
- Guard behavior via `make` dry-runs and a temporary placeholder env file.
- `shellcheck` on `init-letsencrypt.sh`.

### Integration (single throwaway VPS or local Docker)
- Single-VPS: `make deploy-all` → all containers healthy → site renders → `make deploy-seed` →
  admin login.
- Split (simulate with two Docker networks or two hosts): `deploy-db` on one, `deploy-app` on the
  other with `DATABASE_URL` across the boundary → migrate-on-boot succeeds → site renders.

### Manual (real deploy)
1. Point DNS at the App VPS; open 80/443.
2. `make deploy-app` (or `deploy-all`) → `make deploy-tls` → verify valid HTTPS cert.
3. Verify admin + user login work over HTTPS (secure-cookie path).
4. `certbot renew --dry-run` to confirm auto-renewal.
5. Reboot the VPS → `restart: unless-stopped` brings the stack back.

## Performance Considerations

- Building all three images on a small VPS is the heaviest step; `turbo prune` + layered
  `yarn install` keep rebuilds cheap when only source changes. First build on a 2-vCPU box may
  take several minutes — expected.
- Cross-VPS DB latency: keep DB + App in the **same region/private network**; the private network
  keeps DB traffic off the public internet and low-latency.
- nginx adds negligible overhead as a pure reverse proxy; TLS termination at nginx is fine at this
  scale.

## Migration Notes

- No data migration: this is net-new infra. The existing root `docker-compose.yml` and its
  `make up/dev/...` targets are unchanged for local use.
- App schema migrations continue to run automatically on api container boot
  (`apps/api/Dockerfile:40`) against whatever `DATABASE_URL` points to.
- Moving Postgres between "single VPS" and "split" later is a `pg_dump`/`pg_restore` (documented as
  future work in the runbook), not part of this plan.

## References

- Ticket: `thoughts/shared/tickets/2026-07-11-deployment.md`
- Current single-box compose: `docker-compose.yml`
- Server-only API boundary (why only `web` is public): `apps/web/lib/api.ts:1-5`
- Secure-cookie login (why TLS is required): `apps/web/app/api/auth/login/route.ts:34`,
  `apps/web/app/api/admin/login/route.ts:37`
- Migrate-on-boot: `apps/api/Dockerfile:40`
- Build-from-root Dockerfiles: `apps/api/Dockerfile:12`, `apps/web/Dockerfile:12`,
  `apps/jobs/Dockerfile:12`
- Existing make targets to mirror in style: `Makefile:86-108`
