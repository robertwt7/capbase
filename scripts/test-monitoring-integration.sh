#!/usr/bin/env bash
# Only task-owned throwaway DBs; every provider is replaced by synthetic transports.
set -euo pipefail
CONTAINER="${PG_CONTAINER:-capbase-postgres}"
PGUSER="${PGUSER:-capbase}"
PGPASS="${PGPASSWORD:-$PGUSER}"
PORT="${PG_PORT:-5433}"
DB="capbase_monitoring_test_$$"
URL="postgresql://${PGUSER}:${PGPASS}@localhost:${PORT}/${DB}?schema=public"
[[ "$CONTAINER" == capbase-postgres ]] || { echo 'refusing nonlocal container'; exit 1; }
[[ "$DB" =~ ^capbase_monitoring_test_[0-9]+$ ]] || exit 1
cleanup() { docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT TERM
docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres -c "CREATE DATABASE \"$DB\";" >/dev/null
DATABASE_URL="$URL" yarn workspace @repo/db migrate:deploy >/dev/null
export DATABASE_URL="$URL" MONITORING_TEST_DATABASE_URL="$URL" NODE_ENV=test JWT_SECRET=local-monitoring-test-secret-not-production
export RESEND_API_KEY='' SENTRY_DSN='' TURNSTILE_SECRET='' MFA_REQUIRED_ROLES='' MONITORING_ENABLED=false MONITORING_EMAIL_ENABLED=false
# E2E config includes the Nest swagger transform; no network calls to real providers.
if [[ "${MONITORING_FULL_E2E:-false}" == true ]]; then
  export ADMIN_EMAIL=admin@capbase.fyi ADMIN_PASSWORD=admin12345
  SEED_DEMO=true yarn workspace @repo/db seed >/dev/null
  yarn workspace api test:e2e --runInBand
else
  yarn workspace api test:e2e --runInBand --testPathPatterns='saved-searches|monitoring|digest'
fi
