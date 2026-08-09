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
