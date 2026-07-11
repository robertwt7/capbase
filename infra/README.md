# Deployment runbook

Production deployment for Capbase: **Postgres on one VPS, the app on another**
(Option A), or **everything on a single VPS** (Option B). Driven by the compose
files in this folder and the `make deploy-*` targets. The local dev workflow
(root `docker-compose.yml`, `make up/dev/down/...`) is unaffected.

## Architecture

```
                    App VPS                                DB VPS
        ┌─────────────────────────────────┐      ┌─────────────────────┐
browser ──▶ nginx :80/:443 ──▶ web :3001 ─┼──┐   │                     │
        │   (TLS, Let's       (Next.js)   │  │   │   postgres :5432    │
        │    Encrypt)                     │  │   │   (private network) │
        │              api :3000 ◀────────┼──┘   │          ▲          │
        │              (NestJS) ──────────┼──────┼──────────┤          │
        │              jobs :3002 ────────┼──────┼──────────┘          │
        │              (SEC ingest)       │      │                     │
        └─────────────────────────────────┘      └─────────────────────┘
```

- **Only nginx is public** (ports 80/443). `web` reaches the API at
  `http://api:3000` on the internal Docker network.
- **api and jobs are never exposed to the internet.** The browser never talks
  to the API: `API_URL` is a server-only env var (`apps/web/lib/api.ts`) — all
  API calls happen server-side in Next.js. No CORS, no public API surface.
- **HTTPS is required, not optional**: login cookies are `secure`-only in
  production (`apps/web/app/api/*/login/route.ts`), so admin/user login
  silently breaks over plain HTTP.
- **Migrations run automatically**: the api container runs
  `prisma migrate deploy` on every boot (`apps/api/Dockerfile`) against
  whatever `DATABASE_URL` points at.

Files here:

| File | Purpose |
| --- | --- |
| `docker-compose.db.yml` | Postgres only (DB VPS, and base of single-VPS) |
| `docker-compose.app.yml` | web + api + jobs + nginx + certbot + seed profile |
| `docker-compose.all.yml` | single-VPS override: api/jobs wait for local postgres |
| `env/*.env.example` | commented env templates — copy to `*.env` and fill in |
| `nginx/templates/app.conf.template` | nginx vhost (`${DOMAIN}` substituted at boot) |
| `certbot/init-letsencrypt.sh` | one-time TLS bootstrap (`make deploy-tls`) |

Real `env/*.env` files and `certbot/conf|www` state are gitignored.

## Prerequisites

- Docker Engine + the compose plugin on each VPS (`docker compose version`).
- This repo cloned on each VPS (`git clone`, later `git pull` to update) — the
  App VPS builds the images from source.
- A domain with an **A record pointing at the App VPS** public IP.
- Ports open: **22, 80, 443** on the App VPS; **22** (+ 5432, see firewall
  section) on the DB VPS.

## Option A — Split (DB VPS + App VPS)

> ⚠️⚠️ **ORDER MATTERS** ⚠️⚠️
> Deploy the **DB first**, then copy its host + credentials into the App VPS
> env, **then** deploy the app. `make deploy-app` refuses to run while
> `infra/env/app.env` still contains `CHANGE_ME` placeholders — that guard
> exists precisely so this step can't be forgotten.

1. **DB VPS** — start Postgres:

   ```sh
   cp infra/env/db.env.example infra/env/db.env
   # edit infra/env/db.env: set a strong POSTGRES_PASSWORD
   make deploy-db
   ```

2. **Note the DB host + creds.** Use the DB VPS **private IP** once the private
   network is set up (see below); the public IP works only if you firewall 5432
   to the App VPS.

3. **App VPS** — fill the env, *then* deploy:

   ```sh
   cp infra/env/app.env.example infra/env/app.env
   # edit infra/env/app.env:
   #   DATABASE_URL       → postgresql://capbase:<PASS>@<DB_VPS_IP>:5432/capbase?schema=public
   #   DOMAIN             → your domain (A record → this VPS)
   #   LETSENCRYPT_EMAIL  → your email
   #   JWT_SECRET         → openssl rand -hex 32
   #   ADMIN_PASSWORD     → seed admin password
   make deploy-app    # builds images, starts web/api/jobs/nginx/certbot
   make deploy-tls    # one-time Let's Encrypt bootstrap
   make deploy-seed   # first deploy only: admin user + demo data
   ```

   (nginx will restart-loop between `deploy-app` and `deploy-tls` because the
   cert files don't exist yet — that's expected; `deploy-tls` fixes it.)

4. Verify: `https://<domain>` renders, `http://` redirects, and
   `/admin/login` works with the seeded admin.

## Option B — Single VPS ("lazy")

Everything on one box; `DATABASE_URL` points at the internal `postgres`
service, so there is **no cross-VPS step to remember**.

```sh
cp infra/env/all.env.example infra/env/all.env
# edit infra/env/all.env: POSTGRES_PASSWORD (also inside DATABASE_URL!),
# DOMAIN, LETSENCRYPT_EMAIL, JWT_SECRET, ADMIN_PASSWORD
make deploy-all
make deploy-tls
make deploy-seed   # first deploy only
```

## Private network + firewall (Hetzner / exe.dev) — do this for the split

Keeps DB traffic off the public internet. Not scripted; reference steps:

1. Attach **both** VPSes to the same private network in the provider console;
   note the DB VPS **private IP** (e.g. `10.0.0.2`).
2. On the DB VPS: set `POSTGRES_BIND=10.0.0.2` in `infra/env/db.env`, then
   `make deploy-db` again (Postgres now listens only on the private interface).
3. On the App VPS: point the `DATABASE_URL` host in `infra/env/app.env` at that
   private IP, then `make deploy-app`.
4. Firewall (ufw shown; provider firewalls work the same):

   ```sh
   # DB VPS — only SSH + Postgres from the App VPS's private IP
   ufw allow 22/tcp
   ufw allow from <APP_VPS_PRIVATE_IP> to any port 5432 proto tcp
   ufw enable

   # App VPS — SSH + web only
   ufw allow 22/tcp
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw enable
   ```

## Updating / redeploying

On the VPS:

```sh
git pull
make deploy-app    # split (App VPS) — rebuilds changed images, restarts
make deploy-all    # single VPS
```

The api container re-runs `prisma migrate deploy` on boot, so schema
migrations apply automatically. TLS does **not** need re-running: certbot
renews certificates every 12h check-cycle and nginx reloads every 6h.

Other day-2 targets: `make deploy-logs` (tail), `make deploy-down` (stop app
stack, keeps data), `make deploy-seed` (re-seed — wipes + reloads demo data).

## Troubleshooting

- **`make deploy-app` refuses to run** — the `check-env` guard found a missing
  env file or a leftover `CHANGE_ME`. Fill in `infra/env/app.env` (step 3
  above), especially `DATABASE_URL`.
- **Cert issuance fails** (`deploy-tls`): the domain's A record must point at
  this VPS and ports 80/443 must be reachable from the internet *before*
  running it. Check `dig +short <domain>` and the firewall. Re-run with
  `FORCE=1 make deploy-tls` to recreate a bad cert. On a single VPS the script
  automatically uses `infra/env/all.env`.
- **api can't reach the DB** (api container restart-loops on
  `migrate deploy`): check, in order — `POSTGRES_BIND` in `db.env` (is
  Postgres listening on the IP you dialed?), the DB VPS firewall (is 5432 open
  *from the App VPS*?), and the `DATABASE_URL` host/password in `app.env`.
  `make deploy-logs` shows the api's connection errors.
- **Login doesn't work but the site renders** — you're probably on plain HTTP.
  Auth cookies are `secure`-only in production; use `https://` (run
  `make deploy-tls`).
- **Where are the logs?** `make deploy-logs` (app stack), or
  `docker compose -p capbase logs -f <service>`.

## Not covered yet (future work)

- **DB backups** — add a `pg_dump` cron on the DB VPS (and test restores).
- **Connection pooling** — PgBouncer in front of Postgres if connection counts
  grow.
- **Postgres TLS** — `sslmode=require` on `DATABASE_URL` + server certs; the
  private network mitigates this for now.
- **CI image builds** — build/push images in CI + pull on the VPS instead of
  building on-box.
- **Moving single-VPS → split later** — `pg_dump` on the old box,
  `pg_restore` into the new DB VPS, flip `DATABASE_URL`.
