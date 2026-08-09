# Single-VPS Golden Path + Production Hardening Implementation Plan

## Overview

Make the **single-VPS** topology (`make deploy-all`) the documented, defaulted, first-class
deployment path, and close the production gaps that matter on one box: **backups**, **Postgres
exposure**, **Postgres tuning**, **disk/log growth**, and **default credentials**. Replace the
templated nginx vhost with a real static config for `capbase.fyi`, and add a first-class path for
**shipping the already-ingested local dataset to production**. The split-VPS topology stays working,
demoted to an appendix.

## Current State Analysis

`infra/` already supports both topologies (added by
`thoughts/shared/plans/2026-07-11-split-vps-deployment.md`):

| File | Role |
| --- | --- |
| `infra/docker-compose.db.yml` | Postgres — DB VPS *and* the base of the single-VPS stack |
| `infra/docker-compose.app.yml` | api + web + jobs + nginx + certbot + `seed` profile |
| `infra/docker-compose.all.yml` | single-VPS override: re-adds `depends_on: postgres` |
| `infra/nginx/templates/app.conf.template` | vhost with `${DOMAIN}` substituted at boot |
| `infra/env/{db,app,all}.env.example` | commented templates, gitignored when real |

Measured against the advice, item by item:

| Concern | State today | Verdict |
| --- | --- | --- |
| **Backups** | Nothing on prod. `scripts/db-dump.sh` is a manual local tool (hardcoded `backups/`, no encryption, retention, off-site, or restore check). `infra/README.md:177` lists backups as "not covered yet". | ❌ **The one that can end the business.** |
| **Don't lose the volume** | Named volume `capbase-pgdata` (`infra/docker-compose.db.yml:19`); image pinned `postgres:16` (`:6`) — already a pinned major, not `latest`. | ✅ mostly — but `make clean` (`Makefile:158`) is an unguarded `docker compose down -v`. |
| **Don't expose Postgres** | `infra/docker-compose.db.yml:17` publishes `${POSTGRES_BIND:-0.0.0.0}:${POSTGRES_PORT:-5432}:5432`. `all.env.example:8` sets `127.0.0.1`, but the **compose default is `0.0.0.0`**. | ⚠️ safe only if the env file is right. |
| **Tune Postgres** | No `command:`, no config mount → stock `shared_buffers=128MB`. No `mem_limit`/`deploy.resources` on any service in any compose file. | ❌ |
| **Disk** | No `logging:` block anywhere → unbounded `json-file` logs on every service. No free-space check. | ❌ |
| **Accept the downtime** | `restart: unless-stopped` on every service in all three files. | ✅ done |

Plus two structural warts that block "single VPS = golden path":

- `Makefile:178` defines `COMPOSE_APP` from **`docker-compose.app.yml` only**, and `deploy-logs` /
  `deploy-down` / `deploy-seed` all use it. On one box `make deploy-down` leaves Postgres running and
  `make deploy-logs` never shows DB logs. `infra/certbot/init-letsencrypt.sh:25` has the same blind
  spot — its `compose up -d --build` (`:51`) would start only the app services.
- The nginx vhost is a `${DOMAIN}`-substituted template (`infra/nginx/templates/app.conf.template`),
  which buys nothing now that the domain is fixed at **`capbase.fyi`**, and costs a layer of
  indirection plus the awkward `command:` that re-execs the official entrypoint purely to trigger
  template rendering (`infra/docker-compose.app.yml:84-87`).

### The credentials question, answered

`POSTGRES_PASSWORD` and the admin password are **two different secrets**:

| Secret | Protects | Default today |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | the Postgres role — **also duplicated inside `DATABASE_URL`** (`infra/env/all.env.example:6` and `:11`) | `CHANGE_ME_strong_password` |
| `ADMIN_PASSWORD` | the `/admin` moderation login | **`admin12345`** (`packages/db/prisma/seeds/001-admin-user.ts:16`) |

The trap: `001-admin-user.ts:11-13` upserts with `update: {}` — deliberately, so seeding never
clobbers a real user. Consequence: **changing `ADMIN_PASSWORD` and re-running `make deploy-seed`
does not rotate an existing admin's password.** Rotation must write the bcrypt hash directly.

### The local dataset ships with its users — verified, and it bites

The intended production flow is to **restore this machine's already-ingested database** rather than
re-running hours of throttled SEC ingestion. Querying the live local DB shows exactly what a full
`pg_dump` carries across:

```
admin@capbase.dev|ADMIN
contributor@capbase.fyi|USER
robertwt7@gmail.com|USER
```

Three consequences the flow must handle, none of them obvious:

1. **The restore replaces the `User` table**, so the local dev admin's password becomes the
   production admin password. Rotation afterwards is **mandatory**, not optional hygiene.
2. **The local admin is `admin@capbase.dev`, not the `admin@capbase.fyi` default.** A rotation run
   with the default `ADMIN_EMAIL` would fail on a missing record — Prisma's `update` throws when the
   `where` matches nothing.
3. **`make deploy-seed` is a no-op after a restore.** The dump includes `SeedHistory`, so the runner
   (`packages/db/prisma/seeds/runner.ts:33-35`) skips every already-recorded phase. Seeding is for
   the *rebuild-on-prod* path, not the *ship-the-dataset* path.

There is also a mechanical blocker: `scripts/db-restore.sh:41-42` restores to a remote `URL=` by
running `pg_restore` **inside the local container**, dialling the target directly. Once Phase 2
binds production Postgres to loopback, that container cannot reach it. Streaming the dump over SSH
into the VPS's own container is both simpler and firewall-proof.

### Key Discoveries

- **`?connection_limit=` is a no-op here.** Prisma 7 is adapter-based: `packages/db/src/index.ts:12`
  and `apps/api/src/prisma/prisma.service.ts:9` build `new PrismaPg({ connectionString })`, which is
  a plain `pg.Pool`. `pg` does not parse `connection_limit`; its pool `max` defaults to **10 per
  process**. Real ceiling = api (10) + jobs (10) + an occasional one-shot backfill (10) ≈ 30.
  **`max_connections=50` is sized from that, and no PgBouncer is needed at this scale.**
- **The api image can run the rotation.** `apps/api/Dockerfile:37` copies the whole builder `/app`,
  which includes `@repo/db`'s `bcrypt` **and** `tsx` (a devDependency, installed because the builder
  runs a plain `yarn install`). This is exactly why the existing `seed` profile
  (`infra/docker-compose.app.yml:100-108`) works — the rotation follows that pattern.
- **Seed phases are immutable** (`CLAUDE.md`: "never edit a shipped phase"). So the `admin12345`
  fallback in `001-admin-user.ts` is **not** edited; the weak-password guard goes in the deploy layer
  instead, where it can fail loudly before the seed ever runs.
- **`check-env` keys off `CHANGE_ME`** (`Makefile:216`) — so a generator that replaces the
  placeholders clears the guard as a natural side effect, no new guard plumbing needed.
- `scripts/db-dump.sh:14` defaults `PG_CONTAINER=capbase-postgres`, which is the **same
  `container_name` used in production** (`infra/docker-compose.db.yml:7`) — the `docker exec pg_dump`
  approach transfers to the VPS unchanged.
- **The dump carries `_prisma_migrations`** (`scripts/db-dump.sh:5-8`), so after a restore the api
  container's boot-time `migrate deploy` (`apps/api/Dockerfile:40`) is a no-op. Migration history
  arrives intact — no ordering hazard between `deploy-all` and the restore.
- `command:` on the postgres service is safe: the official image's entrypoint runs initdb then
  `exec "$@"`, so `["postgres", "-c", ...]` keeps all bootstrap behaviour.
- **nginx `map` belongs in the `http` context** — files in `/etc/nginx/conf.d/*.conf` are included
  there by the stock `nginx.conf`, so a static conf can define `$connection_upgrade` properly.

## Desired End State

Two production flows, both starting from a fresh 8 GB VPS.

**Flow A — ship this machine's dataset (the one you want):**

```sh
# On your laptop, once:
make backup-keygen                       # age keypair; identity stays HERE, off the VPS

# On the VPS:
git clone … && cd capbase
make deploy-secrets                      # strong POSTGRES_PASSWORD / JWT_SECRET / ADMIN_PASSWORD
$EDITOR infra/env/all.env                # LETSENCRYPT_EMAIL, SEC_USER_AGENT (DOMAIN is preset)
make deploy-all                          # whole stack incl. Postgres
make deploy-tls                          # Let's Encrypt for capbase.fyi

# Back on your laptop:
make db-dump                             # → backups/capbase-<stamp>.dump
make deploy-restore FILE=backups/… VPS=user@host CONFIRM=yes
make rotate-admin-password VPS=user@host ADMIN_EMAIL=admin@capbase.dev   # ← NOT optional

# On the VPS:
echo 'age1…' > infra/backup/recipients.txt
make deploy-backup-cron
```

No `deploy-seed` — the dump already contains every seed phase and its `SeedHistory` rows.

**Flow B — rebuild from public sources on the VPS:** same up to `deploy-tls`, then
`make deploy-seed` and the `ingest-prod` sequence in `docs/DATA_REBUILD.md`.

Verifiable end state:

- `docker compose … config` shows Postgres published **only** on `127.0.0.1`, `shared_buffers=2GB`,
  a `mem_limit` on every service, and `json-file` `max-size` caps on every service.
- `ss -tlnp` on the VPS shows `0.0.0.0:80`, `0.0.0.0:443`, `0.0.0.0:22` — and `5432` only on
  `127.0.0.1`. `psql` from your laptop works through `make db-tunnel`.
- `https://capbase.fyi` serves the site from a **static** `infra/nginx/conf.d/capbase.conf`; there is
  no `templates/` directory and no `NGINX_ENVSUBST_FILTER`.
- `make deploy-backup` writes an `age`-encrypted dump, **restores it into a scratch database and
  prints row counts in the same run**, then prunes dumps older than `BACKUP_KEEP_DAYS`.
- `make deploy-down && make deploy-all` on one box stops and restarts **the whole stack including
  Postgres**, and the data survives.
- `infra/README.md` leads with Flow A end to end; split-VPS is an appendix.

## What We're NOT Doing

- **Not removing or breaking the split-VPS topology.** `deploy-db` / `deploy-app` and
  `infra/env/{db,app}.env.example` keep working; they are demoted in the docs, not deleted.
- **Not bumping `postgres:16` → `17`.** The advice's real point — "pin a major, never `latest`" — is
  already satisfied. A major bump needs a dump/restore cycle (the data directory is not
  forward-compatible), so it is its own maintenance task. The upgrade path is documented, not run.
- **Not adding WAL archiving / PITR** (pgbackrest, wal-g). Nightly dumps bound data loss at 24h.
- **Not adding PgBouncer.** Measured ceiling is ~30 connections against `max_connections=50`.
- **Not wiring cloud object storage credentials.** Backups land on-disk with retention plus a
  documented `BACKUP_UPLOAD_CMD` hook. Encryption is public-key, so the blobs are already safe to
  upload the day a bucket exists.
- **Not rotating `POSTGRES_PASSWORD` on a live database.** Generation at provision time only.
- **Not serving `www.capbase.fyi` by default.** The redirect block ships commented out, because
  enabling it without a `www` DNS record makes cert issuance fail for *both* names. One-line enable
  documented.
- **Not changing app code, the Prisma schema, or any shipped seed phase.** The only non-infra file
  touched is a new standalone script under `packages/db/prisma/`.
- **Not scripting provider firewall APIs.** `ufw` steps are documented in the runbook.

## Implementation Approach

Six phases. **Topology comes first** so that from Phase 1 onward every `deploy-*` target already
operates on the whole single-VPS stack — each later phase is then verifiable through `deploy-all`
rather than deferring integration to the end.

Tuning numbers are for the stated **8 GB** VPS and are exposed as env vars with those defaults, so a
resize is an env edit, not a compose edit.

---

## Phase 1: Single-VPS becomes the golden path in the tooling

### Overview

Make "the stack" mean *the whole stack* for every deploy target, and replace the nginx template with
a real static config for `capbase.fyi`. Everything here is verifiable with `make -n` and
`docker compose config` — no VPS needed.

### Changes Required

#### 1. Topology-aware compose variables

**File**: `Makefile`
**Changes**: Replace the `DEPLOY_ENVF` snippet (`:175-179`) so the **whole compose invocation**
switches topology, not just the env file. Presence of `infra/env/app.env` means split; otherwise
single-VPS — the golden path. Point every day-2 target at `COMPOSE_STACK`.

```makefile
COMPOSE_DB  := $(COMPOSE) -p capbase -f infra/docker-compose.db.yml --env-file infra/env/db.env
COMPOSE_APP := $(COMPOSE) -p capbase -f infra/docker-compose.app.yml --env-file infra/env/app.env
COMPOSE_ALL := $(COMPOSE) -p capbase \
	-f infra/docker-compose.db.yml -f infra/docker-compose.app.yml -f infra/docker-compose.all.yml \
	--env-file infra/env/all.env

# Topology detection. infra/env/app.env present → split VPS (this box runs only
# the app stack). Otherwise → single VPS, the golden path, where "the stack"
# includes Postgres — so deploy-down/logs/ps/seed must cover it too.
ifneq ($(wildcard infra/env/app.env),)
  DEPLOY_ENVF   := infra/env/app.env
  COMPOSE_STACK := $(COMPOSE_APP)
else
  DEPLOY_ENVF   := infra/env/all.env
  COMPOSE_STACK := $(COMPOSE_ALL)
endif

.PHONY: deploy-logs
deploy-logs: ## [VPS] Tail logs from the whole stack (incl. Postgres on a single VPS)
	$(COMPOSE_STACK) logs -f

.PHONY: deploy-ps
deploy-ps: ## [VPS] Show status of the deployed stack
	$(COMPOSE_STACK) ps

.PHONY: deploy-down
deploy-down: ## [VPS] Stop the stack (keeps the database volume — never uses -v)
	$(COMPOSE_STACK) down

.PHONY: deploy-seed
deploy-seed: ## [VPS] Seed the admin user (Flow B only — a restored dump already has it)
	$(COMPOSE_STACK) --profile seed run --rm seed
```

Also widen the help column (`Makefile:230`) from `%-14s` to `%-22s` — `rotate-admin-password` and
`deploy-backup-verify` overflow it.

#### 2. Static nginx config, replacing the template

**File**: `infra/nginx/conf.d/capbase.conf` (new)
**File**: `infra/nginx/templates/app.conf.template` (delete)
**Changes**: A real vhost for `capbase.fyi`, mounted straight into `/etc/nginx/conf.d/`.

```nginx
# Capbase production vhost — capbase.fyi. Mounted read-only at
# /etc/nginx/conf.d/capbase.conf (no ${DOMAIN} templating: the domain is fixed).
#
# ⚠️ The domain is hardcoded here AND set as DOMAIN in infra/env/all.env (used
#    for the cert path and SITE_URL). Change both together — `make deploy-tls`
#    checks they agree and refuses to run if they don't.
#
# Only nginx binds a public port. It proxies to the Next.js `web` container over
# the compose network; api (:3000) and jobs (:3002) are never public and the
# browser never talks to them (API_URL is server-only — apps/web/lib/api.ts:1-5).

# Only send `Connection: upgrade` when the client actually asked to upgrade.
# (`map` must live in the http context — conf.d/*.conf is included there.)
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# Wrong Host (scanners hitting the bare IP) gets dropped without a response.
server {
    listen      80 default_server;
    listen      443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/letsencrypt/live/capbase.fyi/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/capbase.fyi/privkey.pem;

    return 444;
}

server {
    listen      80;
    server_name capbase.fyi;

    # Must stay on :80 — certbot renews via the webroot challenge.
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen      443 ssl;
    http2       on;
    server_name capbase.fyi;

    ssl_certificate     /etc/letsencrypt/live/capbase.fyi/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/capbase.fyi/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    server_tokens off;

    # HSTS is a commitment: browsers refuse plain HTTP for capbase.fyi for a
    # year after each visit. Safe here because login already REQUIRES https —
    # auth cookies are secure-only in production.
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;

    client_max_body_size 2m;   # contribution forms only — no uploads

    gzip            on;
    gzip_proxied    any;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types      text/plain text/css application/javascript application/json
                    application/xml image/svg+xml;

    # Next hashes these filenames, so they can be cached hard.
    location /_next/static/ {
        proxy_pass       http://web:3001;
        proxy_set_header Host $host;
        add_header       Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass         http://web:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        $connection_upgrade;
        proxy_read_timeout 60s;
    }
}

# www → apex. Enable ONLY after (a) adding a www A record and (b) reissuing the
# cert with both names:
#   CERT_DOMAINS='capbase.fyi www.capbase.fyi' FORCE=1 make deploy-tls
# Enabling this without both steps makes issuance fail for BOTH names.
#server {
#    listen      443 ssl;
#    server_name www.capbase.fyi;
#    ssl_certificate     /etc/letsencrypt/live/capbase.fyi/fullchain.pem;
#    ssl_certificate_key /etc/letsencrypt/live/capbase.fyi/privkey.pem;
#    return 301 https://capbase.fyi$request_uri;
#}
```

#### 3. Point nginx at the static conf

**File**: `infra/docker-compose.app.yml`
**Changes**: Swap the template mount for `conf.d`, drop the two template-only env vars, and simplify
the comment on `command:` (the entrypoint re-exec stays — it still runs the image's
`/docker-entrypoint.d/` scripts, it is just no longer needed for *rendering*).

```yaml
  nginx:
    image: nginx:1.27-alpine
    container_name: capbase-nginx
    restart: unless-stopped
    depends_on:
      - web
    ports:
      - '80:80'
      - '443:443'
    # No DOMAIN / NGINX_ENVSUBST_FILTER: the vhost is a static conf, not a template.
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
    # Reload every 6h so renewed certs are picked up without a restart. Still
    # re-execs the official entrypoint so its /docker-entrypoint.d scripts run.
    command: sh -c 'while :; do sleep 6h & wait $${!}; nginx -s reload; done & exec /docker-entrypoint.sh nginx -g "daemon off;"'
```

`DOMAIN` stays in the env file — `web`'s `SITE_URL` default (`:42`) and the TLS script both use it.

#### 4. Topology-aware, conf-aware TLS bootstrap

**File**: `infra/certbot/init-letsencrypt.sh`
**Changes**: Fix the single-file blind spot (`:24-26`), add multi-domain support, and guard the
hardcoded-domain coupling introduced by the static conf.

```sh
# Match the Makefile's topology detection: app.env → split (app stack only),
# otherwise single VPS (the full stack, Postgres included).
if [ "$ENV_FILE" = "infra/env/app.env" ]; then
  COMPOSE_FILES="-f infra/docker-compose.app.yml"
else
  COMPOSE_FILES="-f infra/docker-compose.db.yml -f infra/docker-compose.app.yml -f infra/docker-compose.all.yml"
fi

compose() {
  # shellcheck disable=SC2086
  docker compose -p capbase $COMPOSE_FILES --env-file "$ENV_FILE" "$@"
}

# The vhost hardcodes its server_name, so a DOMAIN that doesn't match would
# issue a cert nginx never serves. Fail early instead.
NGINX_CONF=infra/nginx/conf.d/capbase.conf
if ! grep -q "server_name $DOMAIN;" "$NGINX_CONF"; then
  echo "❌ DOMAIN=$DOMAIN is not a server_name in $NGINX_CONF."
  echo "   Update both, or set DOMAIN to match the vhost."
  exit 1
fi

# CERT_DOMAINS lets you add www later without touching this script.
CERT_DOMAINS="${CERT_DOMAINS:-$DOMAIN}"
d_args=""
for d in $CERT_DOMAINS; do d_args="$d_args -d $d"; done
```

and the issuance call becomes `certbot certonly --webroot -w /var/www/certbot $d_args --email …`.
The cert directory stays `live/$DOMAIN/` (certbot names the lineage after the first `-d`), which is
what the static conf expects.

#### 5. Preset the domain

**File**: `infra/env/all.env.example`
**Changes**: `DOMAIN=capbase.fyi` (was `capbase.example.com`), with a note that it must match the
vhost's `server_name`.

### Success Criteria

#### Automated Verification
- [x] Single-VPS detection picks the full stack: with no `infra/env/app.env`, `make -n deploy-down` prints a command containing all three `-f` files.
- [x] Split detection still works: `touch infra/env/app.env && make -n deploy-down` prints a command with only `docker-compose.app.yml` (then `rm` it).
- [x] `make -n deploy-logs`, `make -n deploy-ps`, `make -n deploy-seed` resolve without Make errors in both modes.
- [x] The template is gone and the static conf exists: `test ! -e infra/nginx/templates && test -f infra/nginx/conf.d/capbase.conf`
- [x] nginx syntax is valid: `docker run --rm -v "$PWD/infra/nginx/conf.d:/etc/nginx/conf.d:ro" nginx:1.27-alpine nginx -t` (expect only the missing-cert error, no syntax errors — or pre-create dummy certs to get a clean `-t`).
- [x] Compose mounts `conf.d`, not `templates`: `docker compose -f infra/docker-compose.app.yml --env-file infra/env/app.env.example config | grep -q 'nginx/conf.d'`
- [x] No `NGINX_ENVSUBST_FILTER` remains: `! grep -rq NGINX_ENVSUBST_FILTER infra/`
- [x] TLS script is syntax-clean: `sh -n infra/certbot/init-letsencrypt.sh`
- [x] The domain guard fires: `DOMAIN=wrong.example.com sh infra/certbot/init-letsencrypt.sh` exits non-zero with the server_name message.
- [x] `make help` renders with the widened column and no truncated target names.

#### Manual Verification
- [ ] On the VPS, `make deploy-all` starts every container including Postgres, and `make deploy-ps` lists all six.
- [ ] `make deploy-tls` obtains a real cert and `https://capbase.fyi` serves the site.
- [ ] `curl -sI http://<vps-ip>/` returns nothing (444 from the default_server) while `curl -sI https://capbase.fyi` returns 200.
- [ ] `curl -sI https://capbase.fyi | grep -i strict-transport-security` shows the HSTS header.
- [ ] `make deploy-down` stops **Postgres too**; `make deploy-all` brings it back with data intact.

**Implementation Note**: Pause for confirmation that `deploy-all` / `deploy-tls` / `deploy-down`
behave on the real VPS before Phase 2.

---

## Phase 2: Harden and tune the compose stack

### Overview

Close the exposure, tuning, memory, and log-growth gaps. Config-only — every criterion is checkable
with `docker compose config` before anything runs.

### Changes Required

#### 1. Postgres: bind private by default, tune, cap memory, cap logs

**File**: `infra/docker-compose.db.yml`

```yaml
# Postgres — the single-VPS default (`make deploy-all`), or standalone on a DB
# VPS (`make deploy-db`). Env: infra/env/all.env (single) / db.env (split).
x-logging: &default-logging
  driver: json-file
  options:
    max-size: '10m'
    max-file: '3'

services:
  postgres:
    image: postgres:16 # pinned major on purpose: a surprise bump won't start on an old PGDATA
    container_name: capbase-postgres
    restart: unless-stopped
    logging: *default-logging
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-capbase}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in your env file}
      POSTGRES_DB: ${POSTGRES_DB:-capbase}
    # DEFAULT IS LOOPBACK-ONLY. Nothing outside the box can reach Postgres;
    # `make db-tunnel` gives you remote psql over SSH instead. Only the SPLIT
    # topology overrides this (to the DB VPS's PRIVATE ip) — see infra/README.md.
    ports:
      - '${POSTGRES_BIND:-127.0.0.1}:${POSTGRES_PORT:-5432}:5432'
    volumes:
      - capbase-pgdata:/var/lib/postgresql/data
    # Sized for an 8 GB box; override in the env file after a resize.
    shm_size: ${PG_SHM_SIZE:-256mb}
    mem_limit: ${PG_MEM_LIMIT:-3g}
    command:
      - postgres
      - -c
      - shared_buffers=${PG_SHARED_BUFFERS:-2GB}             # ~25% RAM
      - -c
      - effective_cache_size=${PG_EFFECTIVE_CACHE_SIZE:-4GB}  # ~50% RAM
      - -c
      - maintenance_work_mem=${PG_MAINTENANCE_WORK_MEM:-512MB}
      - -c
      - work_mem=${PG_WORK_MEM:-16MB}
      # 50 not 100: pg.Pool defaults to max=10/process and we run at most
      # api + jobs + one backfill ≈ 30. See the plan's Key Discoveries.
      - -c
      - max_connections=${PG_MAX_CONNECTIONS:-50}
      - -c
      - random_page_cost=1.1            # SSD, not spinning rust
      - -c
      - effective_io_concurrency=200    # SSD
      - -c
      - checkpoint_completion_target=0.9
      - -c
      - max_wal_size=2GB
      - -c
      - min_wal_size=512MB
      - -c
      - wal_compression=on
      - -c
      - log_min_duration_statement=2000 # log queries slower than 2s
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER:-capbase} -d ${POSTGRES_DB:-capbase}']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  capbase-pgdata:
```

#### 2. App services: memory limits + log caps

**File**: `infra/docker-compose.app.yml`
**Changes**: Add the `x-logging` anchor and a `logging: *default-logging` + `mem_limit` to `api`,
`web`, `jobs`, `nginx`, `certbot`. No topology changes.

```yaml
  api:      { logging: *default-logging, mem_limit: ${API_MEM_LIMIT:-768m} }
  web:      { logging: *default-logging, mem_limit: ${WEB_MEM_LIMIT:-768m} }
  # jobs gets the highest ceiling: the ADV ingest unzips + parses multi-MB bulk
  # files and the Wikidata sweep buffers large SPARQL results.
  jobs:     { logging: *default-logging, mem_limit: ${JOBS_MEM_LIMIT:-1536m} }
  nginx:    { logging: *default-logging, mem_limit: 128m }
  certbot:  { logging: *default-logging, mem_limit: 128m }
```

(shown compressed — apply as ordinary keys on the existing service blocks)

Budget on 8 GB: 3g + 768m + 768m + 1536m + 128m + 128m ≈ **6.3 GB of ceilings** (not
reservations — steady state is far lower), leaving headroom for dockerd and on-box image builds.

#### 3. Same log caps on the local stack

**File**: `docker-compose.yml` (root)
**Changes**: Add the `x-logging` anchor and `logging: *default-logging` to `postgres`, `api`, `web`,
`jobs`. Nothing else changes — unbounded logs fill a dev disk just as well as a VPS one.

#### 4. Env templates: document the knobs

**File**: `infra/env/all.env.example`

```bash
POSTGRES_BIND=127.0.0.1                   # loopback only — use `make db-tunnel` for remote psql
POSTGRES_PORT=5432

# ── Postgres tuning (defaults below are sized for an 8 GB VPS) ──
# After a resize: shared_buffers ≈ 25% RAM, effective_cache_size ≈ 50% RAM,
# and keep PG_MEM_LIMIT comfortably above shared_buffers.
PG_SHARED_BUFFERS=2GB
PG_EFFECTIVE_CACHE_SIZE=4GB
PG_MAINTENANCE_WORK_MEM=512MB
PG_WORK_MEM=16MB
PG_MAX_CONNECTIONS=50
PG_MEM_LIMIT=3g
PG_SHM_SIZE=256mb

# ── Container memory ceilings ──
API_MEM_LIMIT=768m
WEB_MEM_LIMIT=768m
JOBS_MEM_LIMIT=1536m
```

**File**: `infra/env/db.env.example`
**Changes**: Keep `POSTGRES_BIND` **explicitly set** (so split is unaffected by the default flip):

```bash
# ⚠️ The compose DEFAULT is now 127.0.0.1 (loopback). This file overrides it
#    because a DB VPS must be reachable by the App VPS. Set it to the DB VPS's
#    PRIVATE network ip — NEVER a public one — and firewall 5432 to the App VPS.
POSTGRES_BIND=0.0.0.0
```

#### 5. `make db-tunnel` — remote psql without an open port

**File**: `Makefile`

```makefile
TUNNEL_PORT ?= 5433

.PHONY: db-tunnel
db-tunnel: ## [laptop] SSH-tunnel the VPS Postgres to localhost (VPS=user@host [TUNNEL_PORT=5433])
	@test -n "$(VPS)" || { echo "❌ VPS= is required, e.g. make db-tunnel VPS=root@1.2.3.4"; exit 1; }
	@echo "==> Tunnelling $(VPS):5432 → localhost:$(TUNNEL_PORT). Ctrl-C to close."
	@echo "    Connect with: psql 'postgresql://capbase:<POSTGRES_PASSWORD>@localhost:$(TUNNEL_PORT)/capbase'"
	ssh -N -L $(TUNNEL_PORT):127.0.0.1:5432 $(VPS)
```

### Success Criteria

#### Automated Verification
- [x] All combinations still parse: `docker compose -f infra/docker-compose.db.yml -f infra/docker-compose.app.yml -f infra/docker-compose.all.yml --env-file infra/env/all.env.example config -q`
- [x] Split still parses: `docker compose -f infra/docker-compose.db.yml --env-file infra/env/db.env.example config -q && docker compose -f infra/docker-compose.app.yml --env-file infra/env/app.env.example config -q`
- [x] Postgres binds loopback by default: `config` with an env file that omits `POSTGRES_BIND` shows `host_ip: 127.0.0.1`.
- [x] Split env still binds outward: `docker compose -f infra/docker-compose.db.yml --env-file infra/env/db.env.example config | grep -q '0.0.0.0'`
- [x] Tuning reaches the command: `docker compose -f infra/docker-compose.db.yml --env-file infra/env/all.env.example config | grep -q 'shared_buffers=2GB'`
- [x] Every service has a log cap: `… config | grep -c 'max-size'` returns **6**.
- [x] Root compose still parses: `docker compose -f docker-compose.yml config -q`
- [x] Local stack comes up healthy: `make up && make ps`
- [x] `make help | grep -q db-tunnel`

#### Manual Verification
- [ ] `docker exec capbase-postgres psql -U capbase -c 'SHOW shared_buffers;'` prints `2GB`; `SHOW max_connections;` prints `50`.
- [ ] `ss -tlnp | grep 5432` on the VPS shows **only** `127.0.0.1:5432`.
- [ ] `make db-tunnel VPS=…` from the laptop, then a GUI client connects to `localhost:5433`.
- [ ] The site still renders and admin login still works.
- [ ] `docker stats --no-stream` shows the limits, with no container pinned at its ceiling.

**Implementation Note**: Pause until `ss -tlnp` confirms no public 5432 and the tunnel works.

---

## Phase 3: Secret generation + admin password rotation

### Overview

Replace every default credential with generated randomness at provision time, and provide a rotation
path that works **after** first deploy — which the seed phase cannot do, and which Flow A makes
mandatory.

### Changes Required

#### 1. Secret generator

**File**: `scripts/gen-secrets.sh` (new, `chmod +x`)
**Changes**: Create `infra/env/all.env` from the template if absent, then replace **only**
`CHANGE_ME*` placeholders. Refuses to clobber already-provisioned secrets.

Design points that matter:
- **URL-safe alphabet.** `POSTGRES_PASSWORD` is embedded in `DATABASE_URL`; `@ : / ? # %` would
  corrupt the URL. Generate from `[A-Za-z0-9]` only — 62^32 is ample entropy.
- **Rebuilds `DATABASE_URL` from the parts**, so its password can never drift from
  `POSTGRES_PASSWORD` — the exact footgun `all.env.example:4` can only warn about.
- **Refuses to re-run** without `FORCE=yes`, so it can never silently invalidate a live database.
- `chmod 600` the result; print `ADMIN_PASSWORD` exactly once.

```sh
#!/usr/bin/env bash
#
# Fills infra/env/all.env with strong random secrets, replacing the CHANGE_ME
# placeholders (which `make check-env` refuses to deploy with).
#
# Generates:
#   POSTGRES_PASSWORD  — also rewritten inside DATABASE_URL, so the two can't drift
#   JWT_SECRET         — openssl rand -hex 32
#   ADMIN_PASSWORD     — the /admin login (NOT the same thing as POSTGRES_PASSWORD)
#
# Usage: make deploy-secrets [ENVF=infra/env/all.env] [FORCE=yes]
set -euo pipefail

ENVF="${ENVF:-infra/env/all.env}"
EXAMPLE="$ENVF.example"

# URL-safe by construction: these values go inside DATABASE_URL.
randpw() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-32}"; }

if [ ! -f "$ENVF" ]; then
  [ -f "$EXAMPLE" ] || { echo "❌ $EXAMPLE not found"; exit 1; }
  cp "$EXAMPLE" "$ENVF"
  echo "==> Created $ENVF from $(basename "$EXAMPLE")"
fi

if ! grep -q 'CHANGE_ME' "$ENVF" && [ "${FORCE:-}" != "yes" ]; then
  echo "❌ $ENVF has no CHANGE_ME placeholders left — it looks already provisioned."
  echo "   Refusing to overwrite live secrets. To rotate the admin password:"
  echo "       make rotate-admin-password"
  echo "   To regenerate everything anyway (BREAKS an existing database): FORCE=yes make deploy-secrets"
  exit 1
fi

PG_PW="$(randpw 32)"
JWT="$(openssl rand -hex 32)"
ADMIN_PW="$(randpw 24)"

# `|` delimiter is safe: the generated alphabet never contains it.
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PW}|" "$ENVF"
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" "$ENVF"
sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PW}|" "$ENVF"

PG_USER="$(sed -n 's/^POSTGRES_USER=//p' "$ENVF" | tail -1)"
PG_DB="$(sed -n 's/^POSTGRES_DB=//p' "$ENVF" | tail -1)"
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${PG_USER:-capbase}:${PG_PW}@postgres:5432/${PG_DB:-capbase}?schema=public|" "$ENVF"

chmod 600 "$ENVF"

cat <<EOF

==> Secrets written to $ENVF (chmod 600, gitignored)

    POSTGRES_PASSWORD  generated (32 chars) — also synced into DATABASE_URL
    JWT_SECRET         generated (64 hex chars)
    ADMIN_PASSWORD     ${ADMIN_PW}

    ⚠️  SAVE THE ADMIN PASSWORD NOW — printed once. It is the /admin login,
        and is NOT the Postgres password.

    Still to fill in by hand: LETSENCRYPT_EMAIL, SEC_USER_AGENT.
EOF
```

#### 2. Admin password rotation (works on a live database)

**File**: `packages/db/prisma/rotate-admin-password.ts` (new)
**Changes**: A standalone script — **not** a seed phase, because seed phases are immutable and
`001-admin-user.ts` deliberately never updates an existing user. It must fail *helpfully* when the
email doesn't exist, because after a Flow A restore the admin is `admin@capbase.dev`, not the
`admin@capbase.fyi` default.

```ts
import bcrypt from 'bcrypt';

import { createPrismaClient } from '../src';

/** Rotate an existing admin's password. The 001-admin-user seed phase upserts
 *  with `update: {}` so it can never clobber a real user — which also means it
 *  can never rotate one. This is that missing path. */
async function main() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@capbase.fyi';
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 16) {
    throw new Error('ADMIN_PASSWORD must be set and at least 16 characters');
  }

  const prisma = createPrismaClient(process.env.DATABASE_URL!);
  try {
    const target = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!target) {
      // Restoring a local dump brings that machine's users across, so the admin
      // email on production is whatever it was locally (e.g. admin@capbase.dev).
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { email: true },
      });
      throw new Error(
        `No user with email "${email}". ADMIN users in this database: ` +
          (admins.map((a) => a.email).join(', ') || '(none)') +
          '\nRe-run with ADMIN_EMAIL set to one of them.',
      );
    }

    await prisma.user.update({
      where: { email },
      data: { passwordHash: await bcrypt.hash(password, 10), role: 'ADMIN' },
    });
    console.log(`Rotated password for ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

**File**: `packages/db/package.json`
**Changes**: Add `"rotate:admin": "tsx prisma/rotate-admin-password.ts"` (mirrors `seed:baseline` on
`:24`).

#### 3. `rotate-admin` compose profile

**File**: `infra/docker-compose.app.yml`
**Changes**: New one-shot service beside the existing `seed` profile (`:100-108`), reusing the
`capbase-api` image for the same reason `seed` does — it carries `@repo/db`, `bcrypt`, and `tsx`.

```yaml
  # One-shot admin password rotation: `make rotate-admin-password`.
  # Separate from `seed` because 001-admin-user never updates an existing user.
  rotate-admin:
    image: capbase-api
    profiles: ['admin']
    logging: *default-logging
    environment:
      DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL in your env file}
      ADMIN_EMAIL: ${ADMIN_EMAIL:-admin@capbase.fyi}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:?set ADMIN_PASSWORD in your env file}
    command: ['yarn', 'workspace', '@repo/db', 'rotate:admin']
```

#### 4. Rotation wrapper (runs on the VPS, or over SSH from the laptop)

**File**: `scripts/rotate-admin-password.sh` (new, `chmod +x`)
**Changes**: Generate a new password, write it into the env file, run the compose profile, print it
once. `ADMIN_PASSWORD=…` sets a chosen one; `ADMIN_EMAIL=…` targets a specific admin; `VPS=…` runs
the whole thing over SSH so Flow A can finish from the laptop.

```sh
#!/usr/bin/env bash
#
# Rotates the /admin login password on a RUNNING deployment.
# (`make deploy-seed` cannot: 001-admin-user upserts with `update: {}`.)
#
# Usage: make rotate-admin-password [ADMIN_EMAIL=…] [ADMIN_PASSWORD=…] [VPS=user@host]
#
# After a `make deploy-restore` the production admin is whatever your LOCAL
# admin was (e.g. admin@capbase.dev) — pass ADMIN_EMAIL to match. If it's wrong,
# the rotation lists the ADMIN emails it actually found.
set -euo pipefail

if [ -n "${VPS:-}" ]; then
  REPO="${VPS_REPO:-capbase}"
  echo "==> Rotating on $VPS (repo: $REPO)"
  exec ssh -t "$VPS" "cd '$REPO' && ADMIN_EMAIL='${ADMIN_EMAIL:-}' make rotate-admin-password"
fi

ENVF="${ENVF:-infra/env/all.env}"
[ -f "$ENVF" ] || ENVF=infra/env/app.env
[ -f "$ENVF" ] || { echo "❌ no infra/env/all.env or app.env found"; exit 1; }

NEW_PW="${ADMIN_PASSWORD:-$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)}"
sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${NEW_PW}|" "$ENVF"
[ -n "${ADMIN_EMAIL:-}" ] && sed -i "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=${ADMIN_EMAIL}|" "$ENVF"

echo "==> Rotating admin password via the capbase-api image"
"$@"   # the Makefile passes the compose invocation here

cat <<EOF

==> Admin password rotated.

    Email:    $(sed -n 's/^ADMIN_EMAIL=//p' "$ENVF" | tail -1)
    Password: ${NEW_PW}

    ⚠️  SAVE IT NOW — printed once, and $ENVF is gitignored.
EOF
```

#### 5. Makefile targets + a weak-password guard on seeding

**File**: `Makefile`

```makefile
.PHONY: deploy-secrets
deploy-secrets: ## [VPS] Generate strong POSTGRES_PASSWORD / JWT_SECRET / ADMIN_PASSWORD into infra/env/all.env
	@scripts/gen-secrets.sh

.PHONY: rotate-admin-password
rotate-admin-password: ## Rotate the /admin password (ADMIN_EMAIL=… [VPS=user@host])
	@scripts/rotate-admin-password.sh \
		$(COMPOSE_STACK) --profile admin run --rm rotate-admin
```

And harden `deploy-seed` so a default admin password can never reach production — the deploy-layer
guard that replaces editing the immutable seed phase:

```makefile
deploy-seed: check-admin-password ## [VPS] Seed the admin user (Flow B only)
	$(COMPOSE_STACK) --profile seed run --rm seed

# Refuse to seed with the known-weak default. 001-admin-user.ts falls back to
# `admin12345` when ADMIN_PASSWORD is unset — fine locally, fatal in production.
.PHONY: check-admin-password
check-admin-password:
	@pw="$$(sed -n 's/^ADMIN_PASSWORD=//p' $(DEPLOY_ENVF) | tail -1)"; \
	if [ -z "$$pw" ] || [ "$$pw" = "admin12345" ] || [ $${#pw} -lt 16 ]; then \
		echo "❌ ADMIN_PASSWORD in $(DEPLOY_ENVF) is unset, the default, or under 16 chars."; \
		echo "   Run: make deploy-secrets   (or set it by hand)"; \
		exit 1; \
	fi
```

### Success Criteria

#### Automated Verification
- [x] Scripts executable + syntax-clean: `test -x scripts/gen-secrets.sh && test -x scripts/rotate-admin-password.sh && sh -n scripts/gen-secrets.sh && sh -n scripts/rotate-admin-password.sh`
- [x] Generation produces a deployable env: `cp infra/env/all.env.example /tmp/t.env && ENVF=/tmp/t.env scripts/gen-secrets.sh && ! grep -q CHANGE_ME /tmp/t.env`
- [x] The `DATABASE_URL` password matches `POSTGRES_PASSWORD` (the drift footgun) — compare the two parsed values.
- [x] Passwords are URL-safe: `grep -Eq '^POSTGRES_PASSWORD=[A-Za-z0-9]{32}$' /tmp/t.env`
- [x] Re-running refuses to clobber: `ENVF=/tmp/t.env scripts/gen-secrets.sh` exits non-zero.
- [x] The weak-password guard fires: with `ADMIN_PASSWORD=admin12345`, `make deploy-seed` exits non-zero.
- [x] Compose parses with the new profile: `docker compose -f infra/docker-compose.app.yml --env-file infra/env/app.env.example config -q`
- [x] `rotate-admin` is profile-gated (not started by default): `docker compose … config --services | grep -qv rotate-admin`
- [x] Wrong-email rotation is helpful, not cryptic: against the local stack with `ADMIN_EMAIL=nope@example.com`, the run exits non-zero and its output lists `admin@capbase.dev`.
- [x] Correct-email rotation succeeds against the local stack (`ADMIN_EMAIL=admin@capbase.dev`).
- [x] `yarn build && yarn lint` pass with the new db script.

#### Manual Verification
- [ ] After rotation, `/admin` login with the **old** password fails and the **new** one succeeds.
- [ ] `make deploy-secrets` on a fresh clone produces an `all.env` that `make deploy-all` accepts after only `LETSENCRYPT_EMAIL`/`SEC_USER_AGENT` are filled in.
- [ ] `ls -l infra/env/all.env` shows `-rw-------`.
- [ ] The admin password is printed exactly once and never echoed by later targets.

---

## Phase 4: Backup keypair, encrypted backups, verified restores

### Overview

The phase that matters most. **`make backup-keygen` is where the keypair comes from** — run it on
your laptop, once, before anything else; the identity never touches the VPS.

**Encryption design**: `age` in **recipients (public-key) mode**. The VPS holds only the public key,
so it can create backups but never read them — which also makes the blobs safe to upload to any
bucket the day one exists.

**"An untested backup isn't a backup"**: `db-backup.sh` restores the dump it just took into a
throwaway database and prints row counts **on every run**, before encrypting — reusing the proven
pattern in `scripts/verify-fresh-db.sh:19-25`. `db-backup-verify.sh` does the full decrypt→restore
round trip, run from wherever you hold the identity.

### Changes Required

#### 1. Keypair generation — **the answer to "where do I generate the public key"**

**File**: `scripts/backup-keygen.sh` (new, `chmod +x`)
**Changes**: Runs on the **laptop**. Writes the identity outside the repo (so it cannot be committed),
prints the public key, and prints the exact one-liner to run on the VPS.

```sh
#!/usr/bin/env bash
#
# Generates the age keypair used to encrypt production backups. RUN THIS ON YOUR
# LAPTOP, not the VPS — the whole design is that the server can write backups
# but never read them.
#
# Usage: make backup-keygen [IDENTITY=~/.capbase/backup-identity.key]
set -euo pipefail

IDENTITY="${IDENTITY:-$HOME/.capbase/backup-identity.key}"

command -v age-keygen >/dev/null || {
  echo "❌ age-keygen not found."
  echo "   Debian/Ubuntu/WSL: sudo apt-get install -y age"
  echo "   Homebrew:          brew install age"
  echo "   Or:                https://github.com/FiloSottile/age/releases"
  exit 1
}

if [ -f "$IDENTITY" ]; then
  echo "❌ $IDENTITY already exists. Refusing to overwrite — a lost identity means"
  echo "   every backup encrypted to it becomes permanently unreadable."
  echo "   Its public key is:"
  grep '^# public key:' "$IDENTITY" | sed 's/^# public key: /       /'
  exit 1
fi

mkdir -p "$(dirname "$IDENTITY")"
age-keygen -o "$IDENTITY" 2>/dev/null
chmod 600 "$IDENTITY"
PUB="$(grep '^# public key:' "$IDENTITY" | sed 's/^# public key: //')"

cat <<EOF

==> Keypair generated.

    Identity (PRIVATE KEY):  $IDENTITY   [chmod 600]
    Public key:              $PUB

    1. SAVE THE IDENTITY FILE somewhere durable NOW — your password manager, or
       an encrypted drive. It lives OUTSIDE this repo on purpose. Without it,
       every backup encrypted to this key is permanently unrecoverable. There is
       no reset, no recovery, no support channel.

    2. Put the PUBLIC key on the VPS (safe to paste anywhere — it can only
       encrypt, never decrypt):

           ssh <user>@<host> "cd capbase && echo '$PUB' > infra/backup/recipients.txt"

    3. Then, on the VPS:  make deploy-backup-cron

    Restores later use the identity:
        make deploy-backup-verify FILE=…dump.age IDENTITY=$IDENTITY
EOF
```

**File**: `Makefile`

```makefile
.PHONY: backup-keygen
backup-keygen: ## [laptop] Generate the age keypair for backup encryption (run this FIRST, once)
	@scripts/backup-keygen.sh
```

#### 2. Nightly backup script

**File**: `scripts/db-backup.sh` (new, `chmod +x`)
**Changes**: Runs on the VPS. `pg_dump -Fc` inside `capbase-postgres` (same technique as
`scripts/db-dump.sh:32-39`), then verify, encrypt, prune, optional upload.

```sh
#!/usr/bin/env bash
#
# Production backup: dump → verify-restore → encrypt → retain → (optional) upload.
#
# Encryption is age PUBLIC-KEY mode: this box holds only the public key, so it
# can write backups but cannot read them. Generate the pair with
# `make backup-keygen` ON YOUR LAPTOP and copy only the public key here.
#
# Usage: make deploy-backup
# Env:   BACKUP_DIR (/var/backups/capbase), BACKUP_KEEP_DAYS (14),
#        BACKUP_VERIFY (1), BACKUP_MIN_FREE_MB (2048), BACKUP_UPLOAD_CMD (unset)
set -euo pipefail

CONTAINER="${PG_CONTAINER:-capbase-postgres}"
PGUSER="${PGUSER:-capbase}"
PGDATABASE="${PGDATABASE:-capbase}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/capbase}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
RECIPIENTS="${BACKUP_RECIPIENTS:-infra/backup/recipients.txt}"
MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-2048}"

command -v age >/dev/null || {
  echo "❌ 'age' is not installed. Debian 12 / Ubuntu 22.04+: apt-get install -y age"
  exit 1
}
[ -f "$RECIPIENTS" ] || {
  echo "❌ $RECIPIENTS missing — it needs your age PUBLIC key (age1…)."
  echo "   Generate the pair on your laptop: make backup-keygen"
  exit 1
}
docker inspect "$CONTAINER" >/dev/null 2>&1 || { echo "❌ $CONTAINER is not running"; exit 1; }

mkdir -p "$BACKUP_DIR"

# Postgres handles a full disk badly — bail out loudly rather than half-writing.
free_mb="$(df -Pm "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
if [ "$free_mb" -lt "$MIN_FREE_MB" ]; then
  echo "❌ Only ${free_mb}MB free on $BACKUP_DIR (need ${MIN_FREE_MB}MB). Refusing to run."
  exit 1
fi

stamp="$(date -u +%Y%m%d-%H%M%S)"
plain="$(mktemp "${TMPDIR:-/tmp}/capbase-${stamp}.XXXXXX.dump")"
scratch=""
cleanup() {
  rm -f "$plain"
  [ -n "$scratch" ] && docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$scratch\" WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> pg_dump $PGDATABASE"
docker exec "$CONTAINER" pg_dump -U "$PGUSER" -d "$PGDATABASE" \
  --format=custom --no-owner --no-privileges > "$plain"

if [ "${BACKUP_VERIFY:-1}" = "1" ]; then
  # An untested backup isn't a backup: restore this dump into a scratch database
  # and count rows. Same throwaway-DB pattern as scripts/verify-fresh-db.sh.
  scratch="capbase_bkverify_$$"
  echo "==> Verifying: restoring into scratch database $scratch"
  docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres \
    -c "CREATE DATABASE \"$scratch\";" >/dev/null
  docker exec -i "$CONTAINER" pg_restore -U "$PGUSER" -d "$scratch" \
    --no-owner --no-privileges < "$plain"

  echo "==> Row counts in the restored copy"
  docker exec "$CONTAINER" psql -U "$PGUSER" -d "$scratch" -c \
    'SELECT '"'"'Company'"'"' t, count(*) FROM "Company"
     UNION ALL SELECT '"'"'FundingRound'"'"', count(*) FROM "FundingRound"
     UNION ALL SELECT '"'"'Investor'"'"', count(*) FROM "Investor"
     UNION ALL SELECT '"'"'User'"'"', count(*) FROM "User";'

  companies="$(docker exec "$CONTAINER" psql -U "$PGUSER" -d "$scratch" -t -A \
    -c 'SELECT count(*) FROM "Company";')"
  [ "$companies" -gt 0 ] || { echo "❌ Restored copy has 0 companies — backup is NOT good."; exit 1; }
fi

out="$BACKUP_DIR/capbase-${stamp}.dump.age"
echo "==> Encrypting to $out"
age -R "$RECIPIENTS" -o "$out" "$plain"
chmod 600 "$out"

echo "==> Pruning encrypted backups older than ${KEEP_DAYS} days"
find "$BACKUP_DIR" -name 'capbase-*.dump.age' -type f -mtime "+${KEEP_DAYS}" -print -delete

if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  echo "==> Off-site upload"
  BACKUP_FILE="$out" sh -c "$BACKUP_UPLOAD_CMD"
fi

echo "==> Backup OK: $(du -h "$out" | cut -f1)  $out"
```

#### 3. Full round-trip restore check

**File**: `scripts/db-backup-verify.sh` (new, `chmod +x`)

```sh
#!/usr/bin/env bash
#
# Full round-trip check: decrypt an .age backup with your IDENTITY and restore
# it into a throwaway database. This is the half db-backup.sh cannot do — the
# VPS only has the public key.
#
# Usage: make deploy-backup-verify FILE=/var/backups/capbase/capbase-….dump.age \
#          IDENTITY=~/.capbase/backup-identity.key
set -euo pipefail

CONTAINER="${PG_CONTAINER:-capbase-postgres}"
PGUSER="${PGUSER:-capbase}"
FILE="${FILE:?FILE= is required}"
IDENTITY="${IDENTITY:?IDENTITY= is required (your age private key, kept off the VPS)}"
DB="capbase_restorecheck_$$"

cleanup() {
  docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Decrypting $FILE and restoring into $DB"
docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres -c "CREATE DATABASE \"$DB\";" >/dev/null
age -d -i "$IDENTITY" "$FILE" \
  | docker exec -i "$CONTAINER" pg_restore -U "$PGUSER" -d "$DB" --no-owner --no-privileges

echo "==> Row counts"
docker exec "$CONTAINER" psql -U "$PGUSER" -d "$DB" -c \
  'SELECT '"'"'Company'"'"' t, count(*) FROM "Company"
   UNION ALL SELECT '"'"'FundingRound'"'"', count(*) FROM "FundingRound"
   UNION ALL SELECT '"'"'Investor'"'"', count(*) FROM "Investor"
   UNION ALL SELECT '"'"'User'"'"', count(*) FROM "User";'
echo "==> Round trip OK (scratch database dropped)"
```

#### 4. Recipients placeholder + gitignore

**File**: `infra/backup/recipients.txt.example` (new)

```
# Your age PUBLIC key(s) — one per line. `make backup-keygen` prints the exact
# command to create the real recipients.txt on the VPS from this template.
# The PRIVATE key (identity) must NEVER live on the server or in this repo.
age1exampleexampleexampleexampleexampleexampleexampleexampleexampl
```

**File**: `.gitignore`

```gitignore
# infra: backup recipients (keep the .example) + any stray key material
infra/backup/recipients.txt
*.key
```

**File**: `.dockerignore` — add `infra/backup/recipients.txt` and `*.key`.

#### 5. Backup targets + cron installer

**File**: `Makefile`

```makefile
BACKUP_HOUR ?= 3

.PHONY: deploy-backup
deploy-backup: ## [VPS] Run one encrypted, verified backup now
	@scripts/db-backup.sh

.PHONY: deploy-backup-verify
deploy-backup-verify: ## Full round-trip check (FILE=….dump.age IDENTITY=~/.capbase/backup-identity.key)
	@scripts/db-backup-verify.sh

.PHONY: deploy-backup-cron
deploy-backup-cron: ## [VPS] Install the nightly backup cron (needs sudo; BACKUP_HOUR=3)
	@test -f infra/backup/recipients.txt || { \
		echo "❌ infra/backup/recipients.txt missing — run 'make backup-keygen' on your laptop first"; exit 1; }
	@printf '# Capbase nightly DB backup — installed by `make deploy-backup-cron`\nSHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n0 %s * * * root cd %s && ./scripts/db-backup.sh >> /var/log/capbase-backup.log 2>&1\n' \
		"$(BACKUP_HOUR)" "$(CURDIR)" | sudo tee /etc/cron.d/capbase-backup >/dev/null
	@sudo chmod 0644 /etc/cron.d/capbase-backup
	@echo "==> Installed /etc/cron.d/capbase-backup (daily 0$(BACKUP_HOUR):00 → /var/log/capbase-backup.log)"
```

#### 6. Env knobs

**File**: `infra/env/all.env.example`

```bash
# ── Backups (make deploy-backup / deploy-backup-cron) ──
BACKUP_DIR=/var/backups/capbase
BACKUP_KEEP_DAYS=14
BACKUP_VERIFY=1                 # restore-verify every run; 0 to skip (not advised)
BACKUP_MIN_FREE_MB=2048         # refuse to back up below this much free space
# Off-site: backups are already age-encrypted, so any bucket is safe. Install
# the aws CLI, then uncomment ONE. $BACKUP_FILE is set by the script.
#BACKUP_UPLOAD_CMD=aws s3 cp "$BACKUP_FILE" s3://capbase-backups/ --endpoint-url https://<ACCOUNT>.r2.cloudflarestorage.com
#BACKUP_UPLOAD_CMD=aws s3 cp "$BACKUP_FILE" s3://capbase-backups/ --endpoint-url https://s3.us-west-004.backblazeb2.com
#BACKUP_UPLOAD_CMD=aws s3 cp "$BACKUP_FILE" s3://capbase-backups/
```

### Success Criteria

#### Automated Verification
- [x] Scripts executable + syntax-clean: `for f in backup-keygen db-backup db-backup-verify; do test -x scripts/$f.sh && sh -n scripts/$f.sh; done`
- [x] `make backup-keygen IDENTITY=/tmp/k.key` creates a `600` identity and prints an `age1…` public key plus the VPS one-liner.
- [x] Re-running refuses to overwrite: `make backup-keygen IDENTITY=/tmp/k.key` exits non-zero.
- [x] Missing recipients fails loudly: `BACKUP_RECIPIENTS=/nonexistent scripts/db-backup.sh` exits non-zero pointing at `make backup-keygen`.
- [x] The free-space guard fires: `BACKUP_MIN_FREE_MB=99999999 scripts/db-backup.sh` exits non-zero.
- [x] End to end against the local stack (`make up` first): public key into `/tmp/r.txt`, then `BACKUP_DIR=/tmp/bk BACKUP_RECIPIENTS=/tmp/r.txt scripts/db-backup.sh` exits 0, writes one `*.dump.age`, and prints a `Company` count > 0.
- [x] Round trip decrypts: `FILE=$(ls /tmp/bk/*.age) IDENTITY=/tmp/k.key scripts/db-backup-verify.sh` exits 0 with matching row counts.
- [x] No scratch databases leak: `docker exec capbase-postgres psql -U capbase -d postgres -c '\l'` lists no `capbase_bkverify_*` / `capbase_restorecheck_*`.
- [x] Retention prunes: `touch -d '30 days ago' /tmp/bk/capbase-old.dump.age`, re-run, old file gone and new one kept.
- [x] Key material can't be committed: `git check-ignore -q infra/backup/recipients.txt && git check-ignore -q /tmp/../foo.key`
- [x] `make help` lists `backup-keygen` and all three `deploy-backup*` targets.

#### Manual Verification
- [ ] On the VPS: `make deploy-backup-cron`, then next morning `cat /var/log/capbase-backup.log` shows row counts and `Backup OK`.
- [ ] Copy an encrypted backup to your laptop and decrypt it **there** with the identity — the only step that actually proves the recovery path.
- [ ] Confirm the VPS **cannot** decrypt its own backups (`age -d` there fails without the identity) — the intended property.
- [ ] `du -sh /var/backups/capbase` after two weeks is a sane size for the retention window.

**Implementation Note**: Do not take this phase on faith. Pause until you have personally decrypted a
real backup on a machine other than the VPS.

---

## Phase 5: Ship the local dataset to production + operational guardrails

### Overview

Make Flow A a single, safe command, and make the remaining single-box failure modes visible.

### Changes Required

#### 1. `make deploy-restore` — stream the local dump into the VPS

**File**: `scripts/deploy-restore.sh` (new, `chmod +x`)
**Changes**: The existing `db-restore-remote` path (`scripts/db-restore.sh:41-42`) dials the target
from inside the *local* container, which stops working once production Postgres is loopback-only.
Stream the dump over SSH into the VPS's own container instead — no open port, no temp file on the
VPS, no tunnel.

```sh
#!/usr/bin/env bash
#
# Ships a LOCAL dump into the production database over SSH. Production Postgres
# is loopback-only, so the dump is streamed into the VPS's own container rather
# than dialled directly (which is what `make db-restore-remote` does, and why it
# no longer works against a hardened box).
#
# DESTRUCTIVE: replaces every row in production, INCLUDING the User table.
#
# Usage: make deploy-restore FILE=backups/capbase-….dump VPS=user@host CONFIRM=yes
set -euo pipefail

FILE="${FILE:?FILE= is required, e.g. FILE=backups/capbase-….dump}"
VPS="${VPS:?VPS= is required, e.g. VPS=root@1.2.3.4}"
PGUSER="${PGUSER:-capbase}"
PGDATABASE="${PGDATABASE:-capbase}"
CONTAINER="${PG_CONTAINER:-capbase-postgres}"

[ -f "$FILE" ] || { echo "❌ $FILE not found"; exit 1; }

if [ "${CONFIRM:-}" != "yes" ]; then
  echo "❌ Refusing to overwrite the database on $VPS."
  echo "   This REPLACES every row there, including all User accounts."
  echo "   Re-run with CONFIRM=yes if that is what you want."
  exit 1
fi

echo "==> Streaming $(du -h "$FILE" | cut -f1) into $VPS:$CONTAINER/$PGDATABASE"
# --clean --if-exists: works whether the target is empty or already migrated.
ssh "$VPS" "docker exec -i $CONTAINER pg_restore -U $PGUSER -d $PGDATABASE \
  --clean --if-exists --no-owner --no-privileges" < "$FILE"

echo "==> Row counts on production"
ssh "$VPS" "docker exec $CONTAINER psql -U $PGUSER -d $PGDATABASE -c \
  'SELECT '\''Company'\'' t, count(*) FROM \"Company\"
   UNION ALL SELECT '\''FundingRound'\'', count(*) FROM \"FundingRound\"
   UNION ALL SELECT '\''Investor'\'', count(*) FROM \"Investor\";'"

echo "==> Users now on production (these came from your LOCAL database)"
ssh "$VPS" "docker exec $CONTAINER psql -U $PGUSER -d $PGDATABASE -c \
  'SELECT email, role FROM \"User\" ORDER BY role, email;'"

cat <<EOF

==> Restore complete.

    ⚠️  The restore replaced the User table with YOUR LOCAL USERS — including
        the local admin's password hash. Rotate it before anything else:

            make rotate-admin-password VPS=$VPS ADMIN_EMAIL=<the ADMIN listed above>

    The dump carried _prisma_migrations, so the api container's next boot-time
    'migrate deploy' is a no-op. No seeding needed — SeedHistory came across too.
EOF
```

**File**: `Makefile`

```makefile
.PHONY: deploy-restore
deploy-restore: ## [laptop] DESTRUCTIVE: ship a local dump to prod (FILE=… VPS=user@host CONFIRM=yes)
	@scripts/deploy-restore.sh
```

Also amend `db-restore-remote`'s help text (`Makefile:96`) to note it requires a reachable
`DATABASE_URL` and that `deploy-restore` is the path for a loopback-only production box.

#### 2. `make deploy-doctor`

**File**: `scripts/deploy-doctor.sh` (new, `chmod +x`)

```sh
#!/usr/bin/env bash
# Read-only health report for the single-VPS deployment: `make deploy-doctor`.
set -uo pipefail

echo "=== Disk ==="
df -h / "${BACKUP_DIR:-/var/backups/capbase}" 2>/dev/null | sort -u

echo; echo "=== Postgres data volume ==="
docker system df -v 2>/dev/null | grep -E 'VOLUME NAME|capbase-pgdata' || echo "  (volume not found)"

echo; echo "=== Container health ==="
docker ps --filter 'name=capbase-' --format 'table {{.Names}}\t{{.Status}}'

echo; echo "=== Docker log sizes (cap is max-size × max-file per container) ==="
sudo du -ch /var/lib/docker/containers/*/*-json.log 2>/dev/null | tail -1 || echo "  (needs sudo)"

echo; echo "=== Postgres exposure (want 127.0.0.1 only) ==="
ss -tlnp 2>/dev/null | grep ':5432' || echo "  not listening on the host at all — good"

echo; echo "=== Newest backup ==="
ls -lt "${BACKUP_DIR:-/var/backups/capbase}"/capbase-*.dump.age 2>/dev/null | head -1 \
  || echo "  ⚠️  NO BACKUPS FOUND — run: make deploy-backup-cron"
```

#### 3. Guard the `down -v` footgun

**File**: `Makefile`
**Changes**: `make clean` (`:156-158`) deletes the database volume with no confirmation. It targets
the **local** stack, but the muscle memory transfers to a prod shell.

```makefile
.PHONY: clean
clean: ## DESTRUCTIVE: stop the LOCAL stack AND delete its database volume (CONFIRM=yes)
	@if [ "$(CONFIRM)" != "yes" ]; then \
		echo "❌ This deletes the local capbase-pgdata volume (all local data)."; \
		echo "   Re-run with: make clean CONFIRM=yes"; \
		echo "   (There is deliberately no prod equivalent — never run 'down -v' on the VPS.)"; \
		exit 1; \
	fi
	$(COMPOSE) down -v

.PHONY: deploy-doctor
deploy-doctor: ## [VPS] Report disk, volume size, log sizes, container health, backup age
	@scripts/deploy-doctor.sh
```

### Success Criteria

#### Automated Verification
- [x] Executable + syntax-clean: `test -x scripts/deploy-restore.sh && test -x scripts/deploy-doctor.sh && sh -n scripts/deploy-restore.sh && sh -n scripts/deploy-doctor.sh`
- [x] `deploy-restore` refuses without confirmation: `FILE=backups/capbase-20260802-225820.dump VPS=nope@nowhere scripts/deploy-restore.sh` exits non-zero **without** contacting the host.
- [x] It validates inputs: missing `FILE=` and missing `VPS=` each exit non-zero with a usable message.
- [x] `make deploy-doctor` against the local stack exits 0 and prints every section header.
- [x] The doctor reports the missing-backup case: with an empty `BACKUP_DIR`, output contains `NO BACKUPS FOUND`.
- [x] `make clean` without confirmation exits non-zero and the volume survives: `docker volume ls | grep -q capbase-pgdata`
- [x] `make help | grep -qE 'deploy-restore|deploy-doctor'`

#### Manual Verification
- [ ] **Flow A end to end**: `make db-dump` locally, then `make deploy-restore FILE=… VPS=… CONFIRM=yes`. The site on `https://capbase.fyi` shows the same company/investor counts as local.
- [ ] The restore output lists `admin@capbase.dev`, `contributor@capbase.fyi`, `robertwt7@gmail.com` — confirming the User-table warning is real and visible.
- [ ] `make rotate-admin-password VPS=… ADMIN_EMAIL=admin@capbase.dev` succeeds, and `/admin` login works with the new password while the local one no longer does.
- [ ] `make deploy-doctor` on the VPS shows Postgres bound to `127.0.0.1` only.
- [ ] After a week, the reported Docker log total is bounded near `10m × 3 × 6` and not growing.

---

## Phase 6: Documentation

### Overview

Rewrite the runbook around Flow A so the whole sequence is recoverable from memory. Last, so it
documents Phases 1–5 as built.

### Changes Required

#### 1. `infra/README.md` — restructure around the single VPS

- **Architecture** — replace the split diagram with the single-box one:
  `browser → nginx :80/:443 → web :3001 → api :3000 → postgres (compose network only)`,
  `jobs → postgres`. Call out that **only nginx binds a public port** and Postgres is loopback-only.
- **Before you start (once, on your laptop)** — `make backup-keygen`, save the identity, note the
  public key. Placed first because it is the step that is painful to retrofit.
- **Deploy — Flow A: ship the dataset you already have** — the exact numbered sequence from this
  plan's Desired End State, with the **rotate-admin-password step called out as mandatory**, the
  reason why (the dump carries your local `User` rows, and the admin is `admin@capbase.dev`), and the
  note that `deploy-seed` is *not* part of this flow.
- **Deploy — Flow B: rebuild from public sources** — same through `deploy-tls`, then `deploy-seed`
  and the `ingest-prod` sequence, cross-linked to `docs/DATA_REBUILD.md`.
- **Firewall** — default-deny inbound, allow 22/80/443:
  ```sh
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
  ufw enable
  ```
  With the note that 5432 is deliberately absent because Postgres is loopback-only.
- **Remote database access** — `make db-tunnel VPS=user@host`, then connect to `localhost:5433`.
  Explain *why* a tunnel beats an open port: no firewall rule to maintain, survives your home IP
  changing, authenticated by the SSH key you already have.
- **Backups** — where the keypair comes from, why the identity stays off the box,
  `make deploy-backup-cron`, the retention window, the monthly `make deploy-backup-verify` habit, and
  the `BACKUP_UPLOAD_CMD` hook to switch on when a bucket exists. State plainly that until then, a
  dead VPS takes the backups with it.
- **Credentials** — the `POSTGRES_PASSWORD` vs `ADMIN_PASSWORD` table, `make rotate-admin-password`,
  and why re-seeding cannot rotate.
- **nginx** — the vhost is `infra/nginx/conf.d/capbase.conf`, static, domain hardcoded; changing the
  domain means editing both it and `DOMAIN` in `all.env` (the TLS script enforces agreement). How to
  enable the `www` redirect.
- **Tuning** — the 8 GB defaults and the "resize → edit these env vars" rule.
- **Day-2 operations** — `deploy-doctor`, `deploy-logs`, `deploy-ps`, `deploy-down`, redeploy via
  `git pull && make deploy-all`. Explicit: **never `docker compose down -v` on the VPS.**
- **Appendix: split VPS (two boxes)** — the current Option A content kept intact, prefixed with "you
  almost certainly don't need this", plus the note that this is the one topology that must override
  the loopback `POSTGRES_BIND` default.
- **Troubleshooting** — keep the existing entries; **fix `deploy-seed`'s description** (`:89`,
  `:152`), which claims it loads demo data — it does not, since the seed service never sets
  `SEED_DEMO`, so only bootstrap phases apply on prod. Add: backup failures, disk full, OOM-killed
  containers, `rotate-admin-password` reporting no such user.
- **Delete the "DB backups" future-work bullet** (`:177`) — it's covered now. Keep PITR, Postgres
  TLS, and CI image builds, and add the `postgres:16 → 17` upgrade note (backup, stop, remove volume,
  bump tag, restore — never point 17 at a 16 PGDATA).

#### 2. Other docs that name the old path

**File**: `docs/DATA_REBUILD.md`
**Changes**: The "Full rebuild, production" block (`:45-52`) leads with `make deploy-db`, the
split-topology command — lead with `make deploy-all`. Update "Shipping the local dataset to
production" (`:91-127`) to use `make deploy-restore` instead of `make db-restore-remote`, and add the
mandatory rotate-admin step.

**File**: `CLAUDE.md`
**Changes**: Update the "Deployment (Docker + Makefile)" paragraph: single-VPS is the production
topology; name `deploy-secrets` / `backup-keygen` / `deploy-backup` / `deploy-restore` /
`deploy-doctor`; note the static nginx conf replaced the template; point at `infra/README.md`.

### Success Criteria

#### Automated Verification
- [x] Every make target named in the runbook exists: `for t in deploy-all deploy-tls deploy-seed deploy-secrets deploy-restore backup-keygen deploy-backup deploy-backup-cron deploy-backup-verify deploy-doctor deploy-logs deploy-ps deploy-down rotate-admin-password db-tunnel; do grep -q "^$t:" Makefile || echo "MISSING $t"; done` prints nothing.
- [x] The runbook no longer lists backups as future work: `! grep -q 'DB backups.*add a' infra/README.md`
- [x] No doc still references the deleted template: `! grep -rq 'app.conf.template' infra/ docs/ CLAUDE.md README.md`
- [x] No doc still claims `deploy-seed` loads demo data: `! grep -q 'admin user + demo data' infra/README.md`
- [x] Full gate green: `yarn build && yarn lint && yarn test`

#### Manual Verification
- [ ] A fresh read of `infra/README.md` is enough to deploy a new single VPS from zero — keypair, secrets, TLS, dataset restore, admin rotation, backups, firewall — without opening this plan.
- [ ] The Flow A sequence reads in the order you would actually type it, with the rotate step impossible to skim past.
- [ ] The split-VPS appendix is still accurate enough to follow if you ever split.

---

## Testing Strategy

### Config-level (fast, no VPS)
- `docker compose config -q` across all four combinations (db-only, app-only, single-VPS overlay,
  root) with the `.example` envs — after every phase.
- `nginx -t` against the static conf in a throwaway container.
- `sh -n` on all new scripts; `shellcheck` if available.
- `make -n` dry-runs to verify topology detection and every guard in both modes.

### Integration (local Docker, before touching the VPS)
- `make up` → `backup-keygen` → `db-backup.sh` → `db-backup-verify.sh` round trip. Exercises the
  entire backup path against real data with no VPS.
- `make up` → `rotate-admin` profile with both a wrong and a correct `ADMIN_EMAIL` — the wrong one
  must list `admin@capbase.dev` rather than throwing a Prisma stack trace.
- `make deploy-doctor` against the local stack.
- Guard rehearsal: `deploy-restore` without `CONFIRM`, `clean` without `CONFIRM`, `deploy-seed` with
  `admin12345`, `gen-secrets` twice, `backup-keygen` twice — every one must refuse.

### Manual (the real VPS)
1. `make backup-keygen` on the laptop; store the identity.
2. On the VPS: `make deploy-secrets`, fill `LETSENCRYPT_EMAIL`/`SEC_USER_AGENT`, `make deploy-all`,
   `make deploy-tls`.
3. `ss -tlnp` — only 22/80/443 public, 5432 loopback. `ufw status` — default deny.
4. `SHOW shared_buffers` / `SHOW max_connections` inside the container.
5. `make db-tunnel` from the laptop; connect a GUI client.
6. `make db-dump` locally → `make deploy-restore FILE=… VPS=… CONFIRM=yes` → verify the live site
   matches local counts.
7. `make rotate-admin-password VPS=… ADMIN_EMAIL=admin@capbase.dev`; confirm old password fails.
8. `echo 'age1…' > infra/backup/recipients.txt`; `make deploy-backup`; **copy the encrypted dump to
   the laptop and decrypt + restore it there**. This is the only step that proves the backup story.
9. `make deploy-backup-cron`; check the log next morning.
10. Reboot the VPS — `restart: unless-stopped` should bring everything back; `make deploy-doctor`
    confirms.

## Performance Considerations

- `shared_buffers=2GB` on an 8 GB box against a ~11k-company dataset means the working set is fully
  cached — the tuning is about not being pathologically wrong, not squeezing throughput.
- `mem_limit` values are **ceilings, not reservations**; steady state sits far below the ~6.3 GB of
  ceilings, leaving headroom for on-box image builds. If `yarn install`/`next build` gets OOM-killed
  during a deploy, add 2–4 GB of swap rather than lowering the Postgres limit.
- The nightly restore-verification roughly doubles backup runtime (a full `pg_restore` of a ~2.5 MB
  dump). At this size that is seconds; revisit `BACKUP_VERIFY=0` only if the dataset grows by orders
  of magnitude.
- `deploy-restore` streams over SSH, so the transfer is bounded by your upload speed — ~2.5 MB, i.e.
  seconds, versus hours of throttled SEC ingestion for the equivalent rebuild.
- `gzip` at level 5 plus immutable caching on `/_next/static/` cuts repeat-visit bytes materially at
  no meaningful CPU cost for this traffic level.

## Migration Notes

- **Existing deployments**: the `POSTGRES_BIND` default flip is safe for anyone whose env file sets
  the value explicitly — both `.example` templates do. A deployment that *omitted* the key was
  relying on the `0.0.0.0` default and becomes loopback-only after redeploy; on a single VPS that is
  the fix, and `db.env.example` sets it explicitly for the split case.
- **Postgres restarts** when the `command:` changes — a brief outage on the next `make deploy-all`,
  the accepted trade for one box. Data is untouched: the volume and PGDATA are unchanged, and tuning
  flags are runtime settings, not on-disk format.
- **nginx**: deleting `templates/` and adding `conf.d/` is a container-restart change. The domain
  becomes hardcoded, so `DOMAIN` in `all.env` and `server_name` must agree — `deploy-tls` enforces it
  rather than letting you discover it via an unserved certificate.
- **`make db-restore-remote` still exists but no longer reaches a hardened production box** (it dials
  `DATABASE_URL` from the local container). It stays for tunnelled/split use; `deploy-restore` is the
  documented path.
- **No schema migration and no seed phase is added or edited.**
  `packages/db/prisma/rotate-admin-password.ts` sits outside the `seeds/` registry, so `SeedHistory`
  and `scripts/verify-fresh-db.sh:57`'s "3 phases" invariant are unaffected.
- **The age identity is unrecoverable if lost.** `make backup-keygen` says so, refuses to overwrite
  an existing identity, and writes outside the repo. Store it before the first backup runs.
- **`postgres:16 → 17` is deliberately out of scope.** When you do it: `make deploy-backup`, stop the
  stack, remove the volume, bump the tag, start, restore. Never point 17 at a 16 PGDATA.

## References

- Previous deployment plan: `thoughts/shared/plans/2026-07-11-split-vps-deployment.md`
- Current runbook (rewritten in Phase 6): `infra/README.md`
- nginx template being replaced: `infra/nginx/templates/app.conf.template`
- nginx service wiring (mount + `command:`): `infra/docker-compose.app.yml:67-87`
- Postgres service to harden: `infra/docker-compose.db.yml:6-24`
- The `seed` profile pattern that `rotate-admin` mirrors: `infra/docker-compose.app.yml:100-108`
- Why re-seeding can't rotate the admin password: `packages/db/prisma/seeds/001-admin-user.ts:11-13`
- Why `deploy-seed` no-ops after a restore: `packages/db/prisma/seeds/runner.ts:33-35`
- Pool sizing evidence (`pg.Pool`, default max 10): `packages/db/src/index.ts:12`,
  `apps/api/src/prisma/prisma.service.ts:9-12`
- Scratch-database + trap-cleanup pattern reused by the backup verifier: `scripts/verify-fresh-db.sh:14-25`
- `docker exec pg_dump` technique reused by the backup script: `scripts/db-dump.sh:32-39`
- Remote-restore path that loopback binding breaks: `scripts/db-restore.sh:29-44`
- Makefile topology wart being fixed: `Makefile:175-179`, `:200-210`
- TLS bootstrap needing the same fix: `infra/certbot/init-letsencrypt.sh:24-26`, `:51`
- Prod rebuild + dataset-shipping doc to update: `docs/DATA_REBUILD.md:45-52`, `:91-127`
