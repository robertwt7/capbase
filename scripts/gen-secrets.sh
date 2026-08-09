#!/usr/bin/env bash
#
# Fills infra/env/all.env with strong random secrets, replacing the CHANGE_ME
# placeholders (which `make check-env` refuses to deploy with).
#
# Generates:
#   POSTGRES_PASSWORD  — also rewritten inside DATABASE_URL, so the two can't drift
#   JWT_SECRET         — openssl rand -hex 32
#   ADMIN_PASSWORD     — the /admin login (NOT the same thing as POSTGRES_PASSWORD)
#
# Usage: make deploy-secrets [ENVF=infra/env/all.env] [FORCE=yes]
set -euo pipefail

ENVF="${ENVF:-infra/env/all.env}"
EXAMPLE="$ENVF.example"

# URL-safe by construction: these values go inside DATABASE_URL, where
# `@ : / ? # %` would corrupt the URL. 62^32 is ample entropy.
#
# `head -c` reads a BOUNDED slice of /dev/urandom and `tr` filters it to EOF.
# The obvious `tr … </dev/urandom | head -c N` is wrong here: head exits first,
# tr dies of SIGPIPE, and `set -o pipefail` turns that into a fatal 141.
randpw() {
  local n="${1:-32}" out=''
  while [ "${#out}" -lt "$n" ]; do
    out="$out$(head -c "$((n * 3))" /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9')"
  done
  printf '%s' "$out" | cut -c "1-$n"
}

if [ ! -f "$ENVF" ]; then
  [ -f "$EXAMPLE" ] || { echo "❌ $EXAMPLE not found"; exit 1; }
  cp "$EXAMPLE" "$ENVF"
  echo "==> Created $ENVF from $(basename "$EXAMPLE")"
fi

if ! grep -q 'CHANGE_ME' "$ENVF" && [ "${FORCE:-}" != "yes" ]; then
  echo "❌ $ENVF has no CHANGE_ME placeholders left — it looks already provisioned."
  echo "   Refusing to overwrite live secrets. To rotate the admin password:"
  echo "       make rotate-admin-password"
  echo "   To regenerate everything anyway (BREAKS an existing database): FORCE=yes make deploy-secrets"
  exit 1
fi

PG_PW="$(randpw 32)"
JWT="$(openssl rand -hex 32)"
ADMIN_PW="$(randpw 24)"

# `|` delimiter is safe: the generated alphabet never contains it.
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PW}|" "$ENVF"
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" "$ENVF"
sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PW}|" "$ENVF"

# Rebuild DATABASE_URL from the parts so its password can never drift from
# POSTGRES_PASSWORD — the footgun the template can only warn about.
PG_USER="$(sed -n 's/^POSTGRES_USER=//p' "$ENVF" | tail -1)"
PG_DB="$(sed -n 's/^POSTGRES_DB=//p' "$ENVF" | tail -1)"
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${PG_USER:-capbase}:${PG_PW}@postgres:5432/${PG_DB:-capbase}?schema=public|" "$ENVF"

chmod 600 "$ENVF"

cat <<EOF

==> Secrets written to $ENVF (chmod 600, gitignored)

    POSTGRES_PASSWORD  generated (32 chars) — also synced into DATABASE_URL
    JWT_SECRET         generated (64 hex chars)
    ADMIN_PASSWORD     ${ADMIN_PW}

    ⚠️  SAVE THE ADMIN PASSWORD NOW — printed once. It is the /admin login,
        and is NOT the Postgres password.

    Still to fill in by hand: LETSENCRYPT_EMAIL, SEC_USER_AGENT.
EOF
