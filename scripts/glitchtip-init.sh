#!/usr/bin/env bash
#
# One-time GlitchTip bootstrap on the single VPS: `make deploy-glitchtip-init`.
# Idempotent — safe to re-run; it only fills in what is missing.
#
#   1. Generates GLITCHTIP_DB_PASSWORD / GLITCHTIP_SECRET_KEY into the env file
#      (and GLITCHTIP_EMAIL_URL from RESEND_API_KEY, for alert emails).
#   2. Creates the `glitchtip` role + database on the main Postgres.
#   3. Starts GlitchTip and waits for it to come up (it migrates on boot).
#   4. Prompts for the first (and only) dashboard account.
#
# Usage: make deploy-glitchtip-init   (needs the main stack running)
set -euo pipefail

ENVF="${ENVF:-infra/env/all.env}"
CONTAINER="${PG_CONTAINER:-capbase-postgres}"
COMPOSE=(docker compose -p capbase
  -f infra/docker-compose.db.yml -f infra/docker-compose.app.yml
  -f infra/docker-compose.all.yml -f infra/docker-compose.glitchtip.yml
  --env-file "$ENVF")

[ -f "$ENVF" ] || { echo "❌ $ENVF missing"; exit 1; }
docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  echo "❌ $CONTAINER is not running — start the stack first (make deploy-all)"; exit 1; }

env_val() { sed -n "s/^$1=//p" "$ENVF" | tail -n 1 | sed 's/[[:space:]]*#.*$//; s/[[:space:]]*$//'; }
set_if_missing() {
  local key="$1" value="$2"
  if [ -z "$(env_val "$key")" ]; then
    # Replace an empty `KEY=` line if there is one, otherwise append.
    if grep -q "^$key=" "$ENVF"; then
      sed -i "s|^$key=.*|$key=$value|" "$ENVF"
    else
      printf '%s=%s\n' "$key" "$value" >> "$ENVF"
    fi
    echo "==> Wrote $key to $ENVF"
  fi
}

# Hex only: the password goes inside a postgres:// URL.
set_if_missing GLITCHTIP_DB_PASSWORD "$(openssl rand -hex 24)"
set_if_missing GLITCHTIP_SECRET_KEY "$(openssl rand -hex 32)"
resend="$(env_val RESEND_API_KEY)"
if [ -n "$resend" ]; then
  set_if_missing GLITCHTIP_EMAIL_URL "smtp://resend:${resend}@smtp.resend.com:587"
else
  echo "⚠️  RESEND_API_KEY is empty — GlitchTip alert emails will only be logged."
fi
chmod 600 "$ENVF"

PGUSER="$(env_val POSTGRES_USER)"; PGUSER="${PGUSER:-capbase}"
DBPW="$(env_val GLITCHTIP_DB_PASSWORD)"
psql() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d postgres -tA "$@"; }

echo "==> Ensuring role + database 'glitchtip'"
if [ "$(psql -c "SELECT 1 FROM pg_roles WHERE rolname='glitchtip'")" != "1" ]; then
  psql -c "CREATE ROLE glitchtip LOGIN PASSWORD '${DBPW}'" >/dev/null
else
  # Keep the role in step with the env file (e.g. after a manual rotation).
  psql -c "ALTER ROLE glitchtip PASSWORD '${DBPW}'" >/dev/null
fi
if [ "$(psql -c "SELECT 1 FROM pg_database WHERE datname='glitchtip'")" != "1" ]; then
  psql -c "CREATE DATABASE glitchtip OWNER glitchtip" >/dev/null
fi

echo "==> Starting GlitchTip (first boot runs its migrations — give it a minute)"
"${COMPOSE[@]}" up -d glitchtip glitchtip-valkey
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' capbase-glitchtip 2>/dev/null || true)"
  [ "$status" = "healthy" ] && break
  sleep 5
done
[ "${status:-}" = "healthy" ] || {
  echo "❌ GlitchTip did not become healthy. Check: make deploy-glitchtip-logs"; exit 1; }

echo "==> Create the dashboard account (registration is disabled for everyone else)"
"${COMPOSE[@]}" exec glitchtip ./manage.py createsuperuser

cat <<EOT

==> GlitchTip is up at https://${GLITCHTIP_HOST:-errors.capbase.fyi}

Next (see infra/README.md → Error tracking):
  1. If not done yet, add errors.capbase.fyi to the cert:
       CERT_DOMAINS='capbase.fyi errors.capbase.fyi' FORCE=1 make deploy-tls
  2. Sign in, create an organisation and three projects: web, api, jobs.
  3. Paste each project's DSN into $ENVF:
       WEB_SENTRY_DSN=…  API_SENTRY_DSN=…  JOBS_SENTRY_DSN=…
  4. make deploy-all   (recreates the apps with their DSNs)
EOT
