#!/usr/bin/env bash
#
# Dumps the local database to backups/, using pg_dump inside the Postgres
# container so no local client is needed. Custom format (-Fc): compressed, and
# restorable selectively with pg_restore.
#
# The dump includes `_prisma_migrations`, so a restore into an empty database
# leaves migration history intact and `prisma migrate deploy` becomes a no-op on
# the next api boot.
#
# Usage: make db-dump [DATA_ONLY=1]
set -euo pipefail

CONTAINER="${PG_CONTAINER:-capbase-postgres}"
PGUSER="${PGUSER:-capbase}"
PGDATABASE="${PGDATABASE:-capbase}"
OUT_DIR="${OUT_DIR:-backups}"

docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  echo "❌ Postgres container '$CONTAINER' is not running. Try: make db-up"
  exit 1
}

mkdir -p "$OUT_DIR"
stamp="$(date -u +%Y%m%d-%H%M%S)"

if [ "${DATA_ONLY:-0}" = "1" ]; then
  # Rows only — for loading into a database whose schema is already migrated.
  # Excludes migration history so it cannot collide with the rows already there.
  file="$OUT_DIR/capbase-data-${stamp}.dump"
  echo "==> Dumping DATA ONLY from $PGDATABASE"
  docker exec "$CONTAINER" pg_dump -U "$PGUSER" -d "$PGDATABASE" \
    --format=custom --data-only --no-owner --no-privileges \
    --exclude-table-data='_prisma_migrations' > "$file"
else
  file="$OUT_DIR/capbase-${stamp}.dump"
  echo "==> Dumping SCHEMA + DATA from $PGDATABASE"
  docker exec "$CONTAINER" pg_dump -U "$PGUSER" -d "$PGDATABASE" \
    --format=custom --no-owner --no-privileges > "$file"
fi

size="$(du -h "$file" | cut -f1)"
echo "==> Wrote $file ($size)"
echo
echo "Restore locally:  make db-restore FILE=$file"
echo "Restore to prod:  make db-restore-remote FILE=$file URL='postgresql://…' CONFIRM=yes"
