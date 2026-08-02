#!/usr/bin/env bash
#
# Proves the schema rebuilds from empty the way production does: creates a
# throwaway database, applies every migration with `prisma migrate deploy` (the
# same command the api container runs on boot), applies every seed phase, then
# checks the invariants the investor work depends on. Drops the database at the
# end, leaving the real one untouched.
#
# Usage: make db-verify-fresh
set -euo pipefail

CONTAINER="${PG_CONTAINER:-capbase-postgres}"
PGUSER="${PGUSER:-capbase}"
DB="capbase_verify_$$"
PORT="${PG_PORT:-5433}"
URL="postgresql://${PGUSER}:${PGUSER}@localhost:${PORT}/${DB}?schema=public"

psql_db() { docker exec "$CONTAINER" psql -U "$PGUSER" -d "$DB" -t -A -c "$1"; }
cleanup() {
  docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Creating throwaway database $DB"
docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres -c "CREATE DATABASE \"$DB\";" >/dev/null

echo "==> prisma migrate deploy (what the api container runs on boot)"
DATABASE_URL="$URL" yarn workspace @repo/db migrate:deploy

echo "==> Seeding every phase (SEED_DEMO=true)"
SEED_DEMO=true DATABASE_URL="$URL" yarn workspace @repo/db seed

echo "==> Checking invariants"
fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then
    printf '    ok   %-46s %s\n' "$1" "$3"
  else
    printf '    FAIL %-46s expected %s, got %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

check "Investor table exists and is populated" \
  "true" "$([ "$(psql_db 'SELECT count(*) FROM "Investor";')" -gt 0 ] && echo true || echo false)"
check "every holding links to an Investor" \
  "0" "$(psql_db 'SELECT count(*) FROM "InvestorHolding" WHERE "investorId" IS NULL;')"
check "every round position links to an Investor" \
  "0" "$(psql_db 'SELECT count(*) FROM "RoundInvestor" WHERE "investorId" IS NULL;')"
check "no European Investment Bank holdings" \
  "0" "$(psql_db 'SELECT count(*) FROM "InvestorHolding" WHERE name = '"'"'European Investment Bank'"'"';')"
check "no duplicate investor slugs" \
  "0" "$(psql_db 'SELECT count(*) FROM (SELECT slug FROM "Investor" GROUP BY slug HAVING count(*) > 1) d;')"
check "no domain shared by two investors" \
  "0" "$(psql_db 'SELECT count(*) FROM (SELECT domain FROM "Investor" WHERE domain IS NOT NULL GROUP BY domain HAVING count(*) > 1) d;')"
check "all seed phases recorded" \
  "3" "$(psql_db 'SELECT count(*) FROM "SeedHistory";')"

if [ "$fail" -ne 0 ]; then
  echo "==> FRESH REBUILD FAILED"
  exit 1
fi
echo "==> Fresh rebuild OK (database dropped)"
