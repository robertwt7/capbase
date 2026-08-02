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

.PHONY: db-restore-remote
db-restore-remote: ## DESTRUCTIVE: restore a dump into any DB (FILE=… URL=… CONFIRM=yes)
	@scripts/db-restore.sh

# ---------------------------------------------------------------------------
# Ingestion (SEC EDGAR Form D, Wikidata, SEC Form ADV)
# ---------------------------------------------------------------------------

.PHONY: ingest
ingest: ## Run a local backfill (DAYS=N LIMIT=N SOURCE=all|SEC_EDGAR|WIKIDATA|SEC_ADV)
	yarn workspace jobs build
	cd apps/jobs && node dist/backfill.js $(DAYS) $(LIMIT) $(SOURCE)

.PHONY: ingest-prod
ingest-prod: ## Run a backfill inside the jobs container (DAYS=N LIMIT=N SOURCE=...)
	$(COMPOSE) run --rm jobs node apps/jobs/dist/backfill.js $(DAYS) $(LIMIT) $(SOURCE)

.PHONY: ingest-investors
ingest-investors: ## Rebuild the investor universe (SEC Form ADV + Wikidata firms)
	yarn workspace jobs build
	cd apps/jobs && node dist/backfill.js 1 100000 SEC_ADV
	cd apps/jobs && node dist/backfill.js 1 100000 WIKIDATA

.PHONY: ingest-investors-prod
ingest-investors-prod: ## Rebuild the investor universe inside the jobs container
	$(COMPOSE) run --rm jobs node apps/jobs/dist/backfill.js 1 100000 SEC_ADV
	$(COMPOSE) run --rm jobs node apps/jobs/dist/backfill.js 1 100000 WIKIDATA

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
backfill-sectors-prod: ## Fill missing sectors inside the jobs container
	$(COMPOSE) run --rm jobs node apps/jobs/dist/backfill-sectors.js

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
clean: ## Stop the stack AND delete the database volume
	$(COMPOSE) down -v

.PHONY: logs
logs: ## Tail logs from all running services
	$(COMPOSE) logs -f

.PHONY: ps
ps: ## Show status of the stack
	$(COMPOSE) ps

# ---------------------------------------------------------------------------
# Production deployment (split VPS, or single-VPS all-in-one).
# Run these ON the target VPS after `git pull`. See infra/README.md.
# ---------------------------------------------------------------------------

# Shared app-stack targets (tls/seed/logs/down) work on either topology:
# app.env when present (split VPS), else all.env (single VPS).
DEPLOY_ENVF := $(if $(wildcard infra/env/app.env),infra/env/app.env,infra/env/all.env)

COMPOSE_DB  := $(COMPOSE) -p capbase -f infra/docker-compose.db.yml --env-file infra/env/db.env
COMPOSE_APP := $(COMPOSE) -p capbase -f infra/docker-compose.app.yml --env-file $(DEPLOY_ENVF)
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

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

.PHONY: help
help: ## List available commands
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
