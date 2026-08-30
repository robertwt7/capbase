# Deployment runbook

Production deployment for Capbase on **a single VPS** — one box running Postgres,
the app, and nginx. That is the supported, default topology; the two-box split is
kept working but demoted to [an appendix](#appendix-split-vps-two-boxes). Driven
by the compose files in this folder and the `make deploy-*` targets. The local dev
workflow (root `docker-compose.yml`, `make up/dev/down/...`) is unaffected.

## Architecture

```
                          Single VPS
        ┌──────────────────────────────────────────────┐
browser ──▶ nginx :80/:443 ──▶ web :3001 ──▶ api :3000 │
        │   (TLS, Let's        (Next.js)     (NestJS)  │
        │    Encrypt)                            │     │
        │                     jobs :3002 ────────┼─────┤
        │                     (SEC ingest)       ▼     │
        │                            postgres 127.0.0.1:5432
        └──────────────────────────────────────────────┘
```

- **Only nginx binds a public port** (80/443). `web` reaches the API at
  `http://api:3000` on the internal Docker network.
- **Postgres is loopback-only.** The compose default is
  `POSTGRES_BIND=127.0.0.1`, so nothing off the box can reach it. For remote
  `psql`, use [`make db-tunnel`](#remote-database-access) — not an open port.
- **api and jobs are never exposed to the internet.** The browser never talks to
  the API: `API_URL` is a server-only env var (`apps/web/lib/api.ts`) — all API
  calls happen server-side in Next.js. No CORS, no public API surface.
- **HTTPS is required, not optional**: login cookies are `secure`-only in
  production (`apps/web/app/api/*/login/route.ts`), so admin/user login silently
  breaks over plain HTTP.
- **Migrations run automatically**: the api container runs `prisma migrate deploy`
  on every boot (`apps/api/Dockerfile`) against whatever `DATABASE_URL` points at.

Files here:

| File | Purpose |
| --- | --- |
| `docker-compose.db.yml` | Postgres — base of the single-VPS stack (and the DB VPS in the split) |
| `docker-compose.app.yml` | web + api + jobs + nginx + certbot + `seed`/`admin` profiles |
| `docker-compose.all.yml` | single-VPS override: api/jobs wait for the local postgres |
| `env/*.env.example` | commented env templates — copy to `*.env` and fill in |
| `nginx/conf.d/capbase.conf` | the vhost — **static**, domain hardcoded (no templating) |
| `certbot/init-letsencrypt.sh` | one-time TLS bootstrap (`make deploy-tls`) |
| `backup/recipients.txt.example` | where the age **public** key goes on the VPS |

Real `env/*.env` files, `backup/recipients.txt`, `*.key` and `certbot/conf|www`
state are gitignored.

## Prerequisites

- A VPS (these defaults are tuned for **8 GB RAM**) with Docker Engine + the
  compose plugin (`docker compose version`).
- This repo cloned on it (`git clone`, later `git pull` to update) — the box
  builds its own images.
- **`capbase.fyi` A record pointing at the VPS public IP.**
- Ports open: **22, 80, 443**. Deliberately *not* 5432.

---

## Before you start (once, on your laptop)

Generate the backup keypair **first**. It is the one step that is painful to
retrofit: backups taken before it exists are unencrypted, and a key generated on
the server defeats the whole design.

```sh
make backup-keygen          # → ~/.capbase/backup-identity.key + an age1… public key
```

- The **identity (private key)** is written outside the repo, `chmod 600`. **Save
  it in your password manager now.** Lose it and every encrypted backup becomes
  permanently unreadable — there is no recovery path.
- The **public key** is what goes on the VPS. It can only encrypt, so it is safe
  to paste anywhere. `backup-keygen` prints the exact one-liner.

---

## Deploy — Flow A: ship the dataset you already have

The normal path. Your laptop already holds a fully ingested database; copying it
takes about a minute instead of the hours of throttled SEC requests a rebuild
costs, and guarantees production matches what you have been looking at locally.

**1. On the VPS — provision and start the stack:**

```sh
git clone … && cd capbase
make deploy-secrets                 # strong POSTGRES_PASSWORD / JWT_SECRET / ADMIN_PASSWORD
$EDITOR infra/env/all.env           # LETSENCRYPT_EMAIL, SEC_USER_AGENT (DOMAIN is preset)
make deploy-all                     # builds + starts EVERYTHING, Postgres included
make deploy-tls                     # Let's Encrypt for capbase.fyi
```

`make deploy-secrets` prints the generated `ADMIN_PASSWORD` **once** — save it,
though Flow A replaces it in step 3 anyway. It also rewrites the password inside
`DATABASE_URL` so the two can never drift, and `chmod 600`s the file.

(nginx restart-loops between `deploy-all` and `deploy-tls` because the cert files
don't exist yet — expected; `deploy-tls` fixes it.)

**2. Back on your laptop — ship the data:**

```sh
make db-dump                        # → backups/capbase-<utc-stamp>.dump (~2.5 MB)
make deploy-restore FILE=backups/capbase-….dump VPS=user@host CONFIRM=yes
```

The dump is streamed over SSH into the VPS's own Postgres container, so the
loopback binding is not in the way and no port needs opening. It is
**destructive** — every row on production is replaced — hence `CONFIRM=yes`.

**3. Rotate the admin password — MANDATORY, not hygiene:**

```sh
make rotate-admin-password VPS=user@host ADMIN_EMAIL=admin@capbase.dev
```

**Why this is not optional:** the restore replaced the `User` table with *your
local users*, including your local admin's password hash. Until you rotate,
production's admin login is whatever your dev box used.

**Why `ADMIN_EMAIL=` matters:** the admin that came across is
`admin@capbase.dev` (your local one), **not** the `admin@capbase.fyi` default.
Running the rotation without it fails on a missing record. If you get the email
wrong, the script lists the `ADMIN` emails it actually found — `deploy-restore`
also prints the full user table for exactly this reason.

**4. Turn on backups:**

```sh
# on the VPS — the public key printed by `make backup-keygen`
echo 'age1…' > infra/backup/recipients.txt
make deploy-backup-cron
```

**There is no `make deploy-seed` in this flow.** The dump already contains every
seed phase *and* its `SeedHistory` rows, so the seed runner would skip everything
anyway.

---

## Deploy — Flow B: rebuild from public sources on the VPS

Same as Flow A steps 1 and 4, but instead of restoring a dump:

```sh
make deploy-seed                # admin user (bootstrap phases only — no demo data)
make ingest-prod DAYS=1 LIMIT=1000000 SOURCE=SEC_ADV       # managers first…
make ingest-funds-prod                                     # …then their funds…
make ingest-prod DAYS=3650 LIMIT=1000000 SOURCE=SEC_EDGAR  # …then vintages/sizes
make ingest-prod DAYS=1 LIMIT=1000000 SOURCE=WIKIDATA
make backfill-sectors-prod
```

The order is forced: a fund whose manager is not yet in the `Investor` table is
dropped, and the Form D walk can only date and size a fund Schedule D has
already named.

`deploy-seed` refuses to run with a weak `ADMIN_PASSWORD` (unset, `admin12345`,
or under 16 chars) — the seed phase's fallback is fine locally and fatal in
production. The full sequence and expected row counts live in
[`docs/DATA_REBUILD.md`](../docs/DATA_REBUILD.md). A ten-year Form D walk takes
hours; this is why Flow A exists.

---

## Firewall

Default-deny inbound, three ports open:

```sh
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
```

**5432 is deliberately absent.** Postgres binds `127.0.0.1` only, so there is
nothing to firewall — and nothing to accidentally leave open.

## Remote database access

```sh
make db-tunnel VPS=user@host          # then connect to localhost:5433
psql 'postgresql://capbase:<POSTGRES_PASSWORD>@localhost:5433/capbase'
```

A tunnel beats an open port: there is no firewall rule to maintain, it survives
your home IP changing, and it is authenticated by the SSH key you already have.
Override the local port with `TUNNEL_PORT=`.

## Backups

`make deploy-backup` does the whole cycle in one run: `pg_dump` → **restore it
into a scratch database and print row counts** → encrypt → prune → optional
upload. The verify step is not optional decoration — an untested backup isn't a
backup, so every run proves the dump restores before it is kept.

- **Encryption is `age` in public-key mode.** The VPS holds only
  `infra/backup/recipients.txt` (the public key), so it can *write* backups but
  never read them. That is the intended property — verify it by trying `age -d`
  on the box and watching it fail.
- **Retention**: `BACKUP_KEEP_DAYS` (default 14) in `infra/env/all.env`. The
  nightly cron (`make deploy-backup-cron`, `BACKUP_HOUR=3`) logs to
  `/var/log/capbase-backup.log`.
- **Free-space guard**: refuses to run below `BACKUP_MIN_FREE_MB` (2048) rather
  than half-writing a dump onto a full disk.
- **Monthly habit** — prove the recovery path from where the identity lives:
  ```sh
  scp user@host:/var/backups/capbase/capbase-….dump.age .
  make deploy-backup-verify FILE=capbase-….dump.age IDENTITY=~/.capbase/backup-identity.key
  ```
- **Off-site**: not wired up. Backups are already encrypted, so any bucket is
  safe the day you have one — uncomment a `BACKUP_UPLOAD_CMD` in
  `infra/env/all.env`. **Until then, a dead VPS takes its backups with it.**

## Credentials

Two different secrets, often confused:

| Secret | Protects | Where it lives |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | the Postgres role — **also embedded in `DATABASE_URL`** | `infra/env/all.env` |
| `ADMIN_PASSWORD` | the `/admin` moderation login | `infra/env/all.env`, hashed into the DB |

`make deploy-secrets` generates both (plus `JWT_SECRET`) from a URL-safe alphabet
— `@ : / ? #` in a password would corrupt `DATABASE_URL` — and refuses to re-run
over a provisioned file unless you pass `FORCE=yes`.

**Re-seeding cannot rotate the admin password.** The `001-admin-user` seed phase
upserts with `update: {}` so it can never clobber a real user, which also means
it can never update one. `make rotate-admin-password` is that missing path: it
writes a fresh bcrypt hash directly, works on a live database, and prints the new
password once.

Rotating `POSTGRES_PASSWORD` on a live database is *not* automated — generation
happens at provision time only.

## nginx

The vhost is **`nginx/conf.d/capbase.conf`** — a real static config mounted
read-only, not a rendered template. The domain is hardcoded in it.

- **Changing the domain means editing two places**: the `server_name` lines in
  that file *and* `DOMAIN` in `infra/env/all.env` (used for the cert path and
  `SITE_URL`). `make deploy-tls` compares them and refuses to run if they
  disagree, rather than letting you discover it via a certificate nginx never
  serves.
- The catch-all `default_server` returns **444** (drop, no response) so scanners
  hitting the bare IP get nothing.
- HSTS, `nosniff`, a referrer policy, gzip, and immutable caching on
  `/_next/static/` are all set there.
- **`www` redirect**: shipped commented out at the bottom of the file. Enabling
  it without a `www` DNS record makes issuance fail for *both* names. Do it in
  this order — add the `www` A record, uncomment the block, then:
  ```sh
  CERT_DOMAINS='capbase.fyi www.capbase.fyi' FORCE=1 make deploy-tls
  ```

## Tuning

Postgres runs with explicit settings (`shared_buffers=2GB`,
`effective_cache_size=4GB`, `max_connections=50`, SSD-appropriate
`random_page_cost`, …) instead of the stock 128 MB defaults, and every container
has a `mem_limit` and a capped `json-file` log (10 MB × 3).

`max_connections=50` is sized from measurement, not superstition: Prisma 7 is
adapter-based, so `?connection_limit=` is a no-op and the real ceiling is
`pg.Pool`'s default of **10 per process** — api + jobs + an occasional backfill
≈ 30. No PgBouncer needed at this scale.

**All of it is env vars with 8 GB defaults**, so a resize is an edit to
`infra/env/all.env`, never a compose edit:

| Knob | Default | Rule after a resize |
| --- | --- | --- |
| `PG_SHARED_BUFFERS` | `2GB` | ≈ 25% of RAM |
| `PG_EFFECTIVE_CACHE_SIZE` | `4GB` | ≈ 50% of RAM |
| `PG_MEM_LIMIT` | `3g` | comfortably above `shared_buffers` |
| `API_MEM_LIMIT` / `WEB_MEM_LIMIT` | `768m` | — |
| `JOBS_MEM_LIMIT` | `1536m` | highest: ADV unzips multi-MB bulk files |

Ceilings total ≈ 6.3 GB on an 8 GB box — these are limits, not reservations, and
steady state sits far below. If an on-box `next build` gets OOM-killed during a
deploy, add 2–4 GB of swap rather than lowering the Postgres limit.

## Day-2 operations

```sh
make deploy-doctor    # disk, volume size, log sizes, container health, backup age
make deploy-ps        # what's running
make deploy-logs      # tail everything, Postgres included
make deploy-down      # stop the stack, keep the data
git pull && make deploy-all   # redeploy
```

On a single VPS these all cover **the whole stack** — the Makefile detects the
topology from whether `infra/env/app.env` exists.

TLS does not need re-running: certbot renews on a 12h check cycle and nginx
reloads every 6h.

> ⚠️ **Never run `docker compose down -v` on the VPS.** It deletes the
> `capbase-pgdata` volume. There is deliberately no `make` target that does this
> in production; even the local `make clean` now requires `CONFIRM=yes`.

## Troubleshooting

- **`make deploy-all` refuses to run** — the `check-env` guard found a missing
  env file or a leftover `CHANGE_ME`. Run `make deploy-secrets`.
- **`make deploy-seed` refuses to run** — `ADMIN_PASSWORD` is unset, still
  `admin12345`, or under 16 characters. Run `make deploy-secrets`.
- **`rotate-admin-password` says "No user with email …"** — after a Flow A
  restore the admin is your *local* one (`admin@capbase.dev`). The error lists
  every `ADMIN` email in the database; re-run with `ADMIN_EMAIL=` set to one.
- **Cert issuance fails** (`deploy-tls`): the A record must point at this VPS and
  80/443 must be reachable *before* running it. Check `dig +short capbase.fyi`
  and the firewall. `FORCE=1 make deploy-tls` recreates a bad cert. If it
  complains about `server_name`, `DOMAIN` and the vhost disagree — fix both.
- **Backup failed** — check `/var/log/capbase-backup.log`. Common causes:
  `recipients.txt` missing (put the age public key there), `age` not installed
  (`apt-get install -y age`), or the free-space guard tripping.
- **Disk filling up** — `make deploy-doctor` shows the volume, container logs and
  backup directory. Logs are capped at 10 MB × 3 per container; the usual culprit
  is the backup directory with a long `BACKUP_KEEP_DAYS`, or Docker build cache
  (`docker builder prune`).
- **A container keeps restarting after a deploy** — it may be OOM-killed
  (`docker inspect capbase-<svc> --format '{{.State.OOMKilled}}'`). Raise its
  `*_MEM_LIMIT` in `infra/env/all.env` or add swap.
- **api can't reach the DB** (api restart-loops on `migrate deploy`): check the
  `DATABASE_URL` password matches `POSTGRES_PASSWORD` — `make deploy-secrets`
  keeps them in sync, hand-editing does not. `make deploy-logs` shows the errors.
- **Login doesn't work but the site renders** — you're on plain HTTP. Auth
  cookies are `secure`-only in production; run `make deploy-tls`.
- **Where are the logs?** `make deploy-logs`, or
  `docker compose -p capbase logs -f <service>`.

---

## Appendix: split VPS (two boxes)

> **You almost certainly don't need this.** The single VPS above is the supported
> path. This is kept working for the day Postgres needs its own box.

Postgres on one VPS, the app on another. The presence of `infra/env/app.env` is
what switches every `deploy-*` target into split mode.

> ⚠️⚠️ **ORDER MATTERS** ⚠️⚠️
> Deploy the **DB first**, then copy its host + credentials into the App VPS env,
> **then** deploy the app. `make deploy-app` refuses to run while
> `infra/env/app.env` still contains `CHANGE_ME` placeholders.

1. **DB VPS** — start Postgres:

   ```sh
   cp infra/env/db.env.example infra/env/db.env
   # edit: strong POSTGRES_PASSWORD
   make deploy-db
   ```

   **This is the one topology that must override the loopback default.**
   `db.env.example` sets `POSTGRES_BIND` explicitly for that reason — point it at
   the DB VPS's **private** IP (never a public one).

2. **Note the DB host + creds.** Use the private IP once the private network is
   up; a public IP works only if you firewall 5432 to the App VPS.

3. **App VPS** — fill the env, *then* deploy:

   ```sh
   cp infra/env/app.env.example infra/env/app.env
   # edit infra/env/app.env:
   #   DATABASE_URL       → postgresql://capbase:<PASS>@<DB_VPS_PRIVATE_IP>:5432/capbase?schema=public
   #   DOMAIN             → must match server_name in nginx/conf.d/capbase.conf
   #   LETSENCRYPT_EMAIL  → your email
   #   JWT_SECRET         → openssl rand -hex 32
   #   ADMIN_PASSWORD     → 16+ chars
   make deploy-app
   make deploy-tls
   make deploy-seed   # first deploy only
   ```

4. **Private network + firewall** (Hetzner / exe.dev; not scripted):

   ```sh
   # DB VPS — only SSH + Postgres from the App VPS's private IP
   ufw allow 22/tcp
   ufw allow from <APP_VPS_PRIVATE_IP> to any port 5432 proto tcp
   ufw enable

   # App VPS — SSH + web only
   ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
   ufw enable
   ```

Note that `make deploy-restore` and `make db-tunnel` assume the database runs on
the box you SSH into; in a split they target the DB VPS.

## Not covered yet (future work)

- **PITR / WAL archiving** (pgbackrest, wal-g). Nightly dumps bound data loss at
  24h, which is the accepted trade for one box.
- **Off-site backup storage** — the `BACKUP_UPLOAD_CMD` hook exists and the blobs
  are already encrypted; it just needs a bucket.
- **Postgres TLS** — `sslmode=require` + server certs. Moot on a single box where
  the connection never leaves the Docker network.
- **CI image builds** — build/push in CI and pull on the VPS instead of building
  on-box.
- **`postgres:16` → `17`** — the tag is a pinned major on purpose; a bump is its
  own maintenance task because the data directory is not forward-compatible. The
  sequence is: `make deploy-backup`, `make deploy-down`, remove the
  `capbase-pgdata` volume, bump the tag, `make deploy-all`, restore.
  **Never point 17 at a 16 PGDATA.**
- **Moving single-VPS → split later** — `pg_dump` on the old box, `pg_restore`
  into the new DB VPS, flip `DATABASE_URL`, add `infra/env/app.env`.
