# Capbase — common dev & production commands.
# Run `make help` to list every target.

# Backfill window/limit/source (override: `make ingest DAYS=30 LIMIT=500 SOURCE=SEC_EDGAR`).
DAYS   ?= 90
LIMIT  ?= 100000
SOURCE ?= all

COMPOSE := docker compose

.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

.PHONY: install
install: ## Install all workspace dependencies (yarn)
	yarn install

# ---------------------------------------------------------------------------
# Local development (apps run on the host, Postgres in Docker)
# ---------------------------------------------------------------------------

.PHONY: db-up
db-up: ## Start Postgres + apply migrations (non-destructive; keeps existing data)
	$(COMPOSE) up -d --wait postgres
	yarn workspace @repo/db generate
	yarn workspace @repo/db migrate:deploy

.PHONY: db-init
db-init: db-up ## First-time setup: start Postgres, migrate, then apply all seed phases (incl. demo)
	SEED_DEMO=true yarn workspace @repo/db seed

.PHONY: dev
dev: ## Run web (:3001), api (:3000) and jobs (:3002) with hot reload
	yarn dev

.PHONY: build
build: ## Build all workspaces (turbo)
	yarn build

.PHONY: test
test: ## Run unit tests
	yarn test

.PHONY: test-e2e
test-e2e: ## Run end-to-end tests (needs Postgres up)
	yarn test:e2e

.PHONY: lint
lint: ## Lint all workspaces
	yarn lint

# ---------------------------------------------------------------------------
# Database (packages/db, @repo/db)
# ---------------------------------------------------------------------------

.PHONY: db-generate
db-generate: ## Regenerate the Prisma client
	yarn workspace @repo/db generate

.PHONY: db-migrate
db-migrate: ## Create + apply a dev migration
	yarn workspace @repo/db migrate

.PHONY: db-seed
db-seed: ## Apply pending seed phases (incl. demo; skips already-applied ones)
	SEED_DEMO=true yarn workspace @repo/db seed

.PHONY: db-baseline
db-baseline: ## Mark all seed phases as applied WITHOUT running them (existing DBs)
	yarn workspace @repo/db seed:baseline

.PHONY: db-reset
db-reset: ## DESTRUCTIVE: wipe all data, then re-apply every seed phase (incl. demo)
	yarn workspace @repo/db reset

.PHONY: db-verify-fresh
db-verify-fresh: ## Prove a prod-style rebuild works: migrate + seed a throwaway database
	@scripts/verify-fresh-db.sh

# ---------------------------------------------------------------------------
# Backup / transfer (see docs/DATA_REBUILD.md → "Shipping the local dataset")
# ---------------------------------------------------------------------------

.PHONY: db-dump
db-dump: ## Dump the local DB to backups/ (DATA_ONLY=1 for rows without schema)
	@scripts/db-dump.sh

.PHONY: db-restore
db-restore: ## DESTRUCTIVE: recreate the LOCAL db from a dump (FILE=backups/….dump)
	@scripts/db-restore.sh

# Needs a DATABASE_URL the LOCAL container can dial. Production Postgres is
# loopback-only, so use `make deploy-restore` for the VPS.
.PHONY: db-restore-remote
db-restore-remote: ## DESTRUCTIVE: restore into a reachable DB URL (FILE=… URL=… CONFIRM=yes; prod → deploy-restore)
	@scripts/db-restore.sh

.PHONY: deploy-restore
deploy-restore: ## [laptop] DESTRUCTIVE: ship a local dump to prod (FILE=… VPS=user@host CONFIRM=yes)
	@scripts/deploy-restore.sh

# Production Postgres binds loopback only, so remote psql goes through SSH —
# no firewall rule to maintain, and it survives your home IP changing.
TUNNEL_PORT ?= 5433

.PHONY: db-tunnel
db-tunnel: ## [laptop] SSH-tunnel the VPS Postgres to localhost (VPS=user@host [TUNNEL_PORT=5433])
	@test -n "$(VPS)" || { echo "❌ VPS= is required, e.g. make db-tunnel VPS=root@1.2.3.4"; exit 1; }
	@echo "==> Tunnelling $(VPS):5432 → localhost:$(TUNNEL_PORT). Ctrl-C to close."
	@echo "    Connect with: psql 'postgresql://capbase:<POSTGRES_PASSWORD>@localhost:$(TUNNEL_PORT)/capbase'"
	ssh -N -L $(TUNNEL_PORT):127.0.0.1:5432 $(VPS)

# ---------------------------------------------------------------------------
# Ingestion (SEC EDGAR Form D, Wikidata, SEC Form ADV)
# ---------------------------------------------------------------------------

.PHONY: ingest
ingest: ## Run a local backfill (DAYS=N LIMIT=N SOURCE=all|SEC_EDGAR|WIKIDATA|SEC_ADV)
	yarn workspace jobs build
	cd apps/jobs && node dist/backfill.js $(DAYS) $(LIMIT) $(SOURCE)

# The *-prod targets run inside the DEPLOYED stack (COMPOSE_STACK), not the root
# dev compose file — that one hardcodes the local `capbase:capbase` credentials.
.PHONY: ingest-prod
ingest-prod: ## [VPS] Run a backfill inside the deployed jobs container (DAYS=N LIMIT=N SOURCE=...)
	$(COMPOSE_STACK) run --rm jobs node apps/jobs/dist/backfill.js $(DAYS) $(LIMIT) $(SOURCE)

.PHONY: ingest-investors
ingest-investors: ## Rebuild the investor universe (SEC Form ADV + Wikidata firms)
	yarn workspace jobs build
	cd apps/jobs && node dist/backfill.js 1 100000 SEC_ADV
	cd apps/jobs && node dist/backfill.js 1 100000 WIKIDATA

.PHONY: ingest-investors-prod
ingest-investors-prod: ## [VPS] Rebuild the investor universe inside the deployed jobs container
	$(COMPOSE_STACK) run --rm jobs node apps/jobs/dist/backfill.js 1 100000 SEC_ADV
	$(COMPOSE_STACK) run --rm jobs node apps/jobs/dist/backfill.js 1 100000 WIKIDATA

.PHONY: ingest-all
ingest-all: ## Full data rebuild from every source (DAYS=N, default 3650). See docs/DATA_REBUILD.md
	yarn workspace jobs build
	cd apps/jobs && node dist/backfill.js $(or $(DAYS),3650) 1000000 SEC_EDGAR
	cd apps/jobs && node dist/backfill.js 1 1000000 WIKIDATA
	cd apps/jobs && node dist/backfill.js 1 1000000 SEC_ADV
	cd apps/jobs && node dist/backfill-sectors.js

.PHONY: backfill-sectors
backfill-sectors: ## Fill missing Company.primarySector from stored industry values
	yarn workspace jobs build
	cd apps/jobs && node dist/backfill-sectors.js

.PHONY: backfill-sectors-prod
backfill-sectors-prod: ## [VPS] Fill missing sectors inside the deployed jobs container
	$(COMPOSE_STACK) run --rm jobs node apps/jobs/dist/backfill-sectors.js

# ---------------------------------------------------------------------------
# Production-like stack (everything in Docker)
# ---------------------------------------------------------------------------

.PHONY: up
up: ## Build images and start the full stack (postgres + api + web + jobs)
	$(COMPOSE) up -d --build --wait

.PHONY: seed
seed: ## One-shot: load demo data into the running stack
	$(COMPOSE) --profile seed run --rm seed

.PHONY: down
down: ## Stop the stack (keeps the database volume)
	$(COMPOSE) down

.PHONY: clean
clean: ## DESTRUCTIVE: stop the LOCAL stack AND delete its database volume (CONFIRM=yes)
	@if [ "$(CONFIRM)" != "yes" ]; then \
		echo "❌ This deletes the local capbase-pgdata volume (all local data)."; \
		echo "   Re-run with: make clean CONFIRM=yes"; \
		echo "   (There is deliberately no prod equivalent — never run 'down -v' on the VPS.)"; \
		exit 1; \
	fi
	$(COMPOSE) down -v

.PHONY: logs
logs: ## Tail logs from all running services
	$(COMPOSE) logs -f

.PHONY: ps
ps: ## Show status of the stack
	$(COMPOSE) ps

# ---------------------------------------------------------------------------
# Production deployment. Single VPS is the golden path (`make deploy-all`);
# the split two-box topology still works. Run these ON the target VPS after
# `git pull`. See infra/README.md.
# ---------------------------------------------------------------------------

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

.PHONY: deploy-secrets
deploy-secrets: ## [VPS] Generate strong POSTGRES_PASSWORD / JWT_SECRET / ADMIN_PASSWORD into infra/env/all.env
	@scripts/gen-secrets.sh

.PHONY: rotate-admin-password
rotate-admin-password: ## Rotate the /admin password (ADMIN_EMAIL=… [VPS=user@host])
	@scripts/rotate-admin-password.sh \
		$(COMPOSE_STACK) --profile admin run --rm rotate-admin

.PHONY: deploy-seed
deploy-seed: check-admin-password ## [VPS] Seed the admin user (Flow B only — a restored dump already has it)
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

.PHONY: deploy-logs
deploy-logs: ## [VPS] Tail logs from the whole stack (incl. Postgres on a single VPS)
	$(COMPOSE_STACK) logs -f

.PHONY: deploy-ps
deploy-ps: ## [VPS] Show status of the deployed stack
	$(COMPOSE_STACK) ps

.PHONY: deploy-down
deploy-down: ## [VPS] Stop the stack (keeps the database volume — never uses -v)
	$(COMPOSE_STACK) down

.PHONY: deploy-doctor
deploy-doctor: ## [VPS] Report disk, volume size, log sizes, container health, backup age
	@scripts/deploy-doctor.sh

# ---------------------------------------------------------------------------
# Backups (age public-key encryption; the identity never touches the VPS)
# ---------------------------------------------------------------------------

BACKUP_HOUR ?= 3

.PHONY: backup-keygen
backup-keygen: ## [laptop] Generate the age keypair for backup encryption (run this FIRST, once)
	@scripts/backup-keygen.sh

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

# Guard: env file must exist and have no CHANGE_ME placeholders left.
.PHONY: check-env
check-env:
	@test -f "$(ENVF)" || { echo "❌ $(ENVF) missing — copy $(ENVF).example and fill it in"; exit 1; }
	@if grep -qE 'CHANGE_ME' "$(ENVF)"; then \
		echo "❌ $(ENVF) still has CHANGE_ME placeholders."; \
		echo "   Did you set DATABASE_URL after deploying the DB? See infra/README.md."; \
		exit 1; \
	fi

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

.PHONY: help
help: ## List available commands
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
