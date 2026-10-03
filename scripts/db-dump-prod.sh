#!/usr/bin/env bash
#
# The dump you ship to production (Flow A): the local database minus the demo
# seed companies, e2e test accounts and their submissions, and the seeded demo
# contributor (scripts/sql/prod-cleanup.sql).
#
# The cleanup runs on a throwaway COPY inside the local Postgres container, so
# the local database — which the e2e suite and local dev depend on — is never
# touched. Prints before/after row counts so you can see what went.
#
# Usage: make db-dump-prod   → backups/capbase-prod-<utc-stamp>.dump
#        then: make deploy-restore FILE=backups/capbase-prod-….dump VPS=… CONFIRM=yes
set -euo pipefail

cd "$(dirname "$0")/.."
CONTAINER="${PG_CONTAINER:-capbase-postgres}"
PGUSER="${PGUSER:-capbase}"
PGDATABASE="${PGDATABASE:-capbase}"
OUT_DIR="${OUT_DIR:-backups}"
SCRATCH="capbase_prodcut_$$"

docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  echo "❌ Postgres container '$CONTAINER' is not running. Try: make db-up"; exit 1; }

psql_in() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PGUSER" "$@"; }
cleanup() {
  psql_in -d postgres -qc "DROP DATABASE IF EXISTS \"$SCRATCH\" WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

counts() {
  psql_in -d "$1" -c '
    SELECT (SELECT count(*) FROM "Company")         AS companies,
           (SELECT count(*) FROM "FundingRound")    AS rounds,
           (SELECT count(*) FROM "Investor")        AS investors,
           (SELECT count(*) FROM "Person")          AS people,
           (SELECT count(*) FROM "Fund")            AS funds,
           (SELECT count(*) FROM "Citation")        AS citations,
           (SELECT count(*) FROM "User")            AS users;'
}

echo "==> Copying $PGDATABASE into scratch database $SCRATCH"
psql_in -d postgres -qc "CREATE DATABASE \"$SCRATCH\";"
docker exec "$CONTAINER" sh -c \
  "pg_dump -U '$PGUSER' -d '$PGDATABASE' --format=custom --no-owner --no-privileges \
   | pg_restore -U '$PGUSER' -d '$SCRATCH' --no-owner --no-privileges"

echo "==> Before"
counts "$SCRATCH"
echo "==> Removing demo + test data (scripts/sql/prod-cleanup.sql)"
psql_in -d "$SCRATCH" -q < scripts/sql/prod-cleanup.sql
echo "==> After"
counts "$SCRATCH"
echo "==> Accounts that will ship (rotate the admin password after restoring)"
psql_in -d "$SCRATCH" -c 'SELECT email, role FROM "User" ORDER BY role, email;'

mkdir -p "$OUT_DIR"
file="$OUT_DIR/capbase-prod-$(date -u +%Y%m%d-%H%M%S).dump"
docker exec "$CONTAINER" pg_dump -U "$PGUSER" -d "$SCRATCH" \
  --format=custom --no-owner --no-privileges > "$file"
echo "==> Wrote $file ($(du -h "$file" | cut -f1))"
echo
echo "Ship it:  make deploy-restore FILE=$file VPS=user@host CONFIRM=yes"
echo "Then:     make rotate-admin-password VPS=user@host"
