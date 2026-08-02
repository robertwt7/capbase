#!/usr/bin/env bash
#
# Restores a dump produced by scripts/db-dump.sh. pg_restore runs inside the
# local Postgres container, so the target may be local or a remote host the
# container can reach — no local client needed.
#
#   make db-restore FILE=backups/capbase-….dump
#       Recreates the LOCAL dev database from scratch and restores into it.
#
#   make db-restore-remote FILE=… URL='postgresql://…' CONFIRM=yes
#       Restores into any database URL (i.e. production).
#
# DESTRUCTIVE in both forms: everything currently in the target is replaced.
set -euo pipefail

CONTAINER="${PG_CONTAINER:-capbase-postgres}"
PGUSER="${PGUSER:-capbase}"
PGDATABASE="${PGDATABASE:-capbase}"
FILE="${FILE:-}"
URL="${URL:-}"

[ -n "$FILE" ] || { echo "❌ FILE= is required, e.g. FILE=backups/capbase-….dump"; exit 1; }
[ -f "$FILE" ] || { echo "❌ $FILE not found"; exit 1; }
docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  echo "❌ Postgres container '$CONTAINER' is not running. Try: make db-up"
  exit 1
}

if [ -n "$URL" ]; then
  # --- Remote / production -------------------------------------------------
  # Never let a stray command wipe production: require an explicit CONFIRM.
  redacted="$(printf '%s' "$URL" | sed -E 's#://[^:]+:[^@]+@#://***:***@#')"
  if [ "${CONFIRM:-}" != "yes" ]; then
    echo "❌ Refusing to overwrite $redacted"
    echo "   This REPLACES every row in that database. Re-run with CONFIRM=yes if that is what you want."
    exit 1
  fi
  echo "==> Restoring $FILE into $redacted"
  # --clean --if-exists drops existing objects first, so this also works when
  # the target already has a migrated (or populated) schema.
  docker exec -i "$CONTAINER" pg_restore \
    --dbname="$URL" --clean --if-exists --no-owner --no-privileges < "$FILE"
  echo "==> Restore complete"
  exit 0
fi

# --- Local dev -------------------------------------------------------------
echo "==> Recreating local database '$PGDATABASE' (all current data is dropped)"
docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres \
  -c "DROP DATABASE IF EXISTS \"$PGDATABASE\" WITH (FORCE);" >/dev/null
docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres \
  -c "CREATE DATABASE \"$PGDATABASE\";" >/dev/null

echo "==> Restoring $FILE"
docker exec -i "$CONTAINER" pg_restore \
  -U "$PGUSER" -d "$PGDATABASE" --no-owner --no-privileges < "$FILE"

echo "==> Row counts"
docker exec "$CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -c \
  'SELECT '"'"'Company'"'"' t, count(*) FROM "Company"
   UNION ALL SELECT '"'"'FundingRound'"'"', count(*) FROM "FundingRound"
   UNION ALL SELECT '"'"'Investor'"'"', count(*) FROM "Investor"
   UNION ALL SELECT '"'"'InvestorHolding'"'"', count(*) FROM "InvestorHolding";'
