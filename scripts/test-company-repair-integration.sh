#!/usr/bin/env bash
#
# Company-match repair against a real PostgreSQL, in a database this run owns:
# creates capbase_repair_test_<pid> in the local Postgres container, applies every
# migration to it (and only it), runs the integration suite, and drops it — on
# success, failure or Ctrl-C. Never touches DATABASE_URL's database, never runs
# migrate dev/reset, and refuses any other database name.
#
# Usage: make test-company-repair-integration
set -euo pipefail

CONTAINER="${PG_CONTAINER:-capbase-postgres}"
PGUSER="${PGUSER:-capbase}"
PGPASS="${PGPASSWORD:-$PGUSER}"
PORT="${PG_PORT:-5433}"
DB="capbase_repair_test_$$"
URL="postgresql://${PGUSER}:${PGPASS}@localhost:${PORT}/${DB}?schema=public"

case "$DB" in
  capbase_repair_test_[0-9]*) ;;
  *) echo "refusing: $DB is not a task-owned test database" >&2; exit 1 ;;
esac

cleanup() {
  docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "==> Creating task-owned database $DB"
docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres -c "CREATE DATABASE \"$DB\";" >/dev/null

echo "==> prisma migrate deploy (into $DB only)"
DATABASE_URL="$URL" yarn workspace @repo/db migrate:deploy >/dev/null

echo "==> Building the jobs CLI"
yarn workspace jobs build >/dev/null

echo "==> Integration suite"
cd apps/jobs
REPAIR_TEST_DATABASE_URL="$URL" NODE_OPTIONS=--experimental-vm-modules npx jest -c test/jest-integration.json --runInBand --coverage=false "$@"
