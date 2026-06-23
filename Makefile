# Capbase — common dev & production commands.
# Run `make help` to list every target.

# Max SEC Form D filings to process in a backfill (override: `make ingest LIMIT=10`).
LIMIT ?= 50

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
db-up: ## Start Postgres, apply migrations, and seed demo data
	$(COMPOSE) up -d --wait postgres
	yarn workspace @repo/db generate
	yarn workspace @repo/db migrate:deploy
	yarn workspace @repo/db seed

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
db-seed: ## Re-seed the database with demo data
	yarn workspace @repo/db seed

# ---------------------------------------------------------------------------
# Ingestion (SEC EDGAR Form D)
# ---------------------------------------------------------------------------

.PHONY: ingest
ingest: ## Run a local SEC Form D backfill (LIMIT=N, default 50)
	yarn workspace jobs build
	cd apps/jobs && node dist/backfill.js $(LIMIT)

.PHONY: ingest-prod
ingest-prod: ## Run a backfill inside the jobs container (LIMIT=N)
	$(COMPOSE) run --rm jobs node apps/jobs/dist/backfill.js $(LIMIT)

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
# Help
# ---------------------------------------------------------------------------

.PHONY: help
help: ## List available commands
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
