#!/usr/bin/env bash
#
# Rotates the /admin login password on a RUNNING deployment.
# (`make deploy-seed` cannot: 001-admin-user upserts with `update: {}`.)
#
# Usage: make rotate-admin-password [ADMIN_EMAIL=…] [ADMIN_PASSWORD=…] [VPS=user@host]
#
# The Makefile appends the compose invocation as this script's arguments; the
# script writes the new secret into the env file first, then runs it.
#
# After a `make deploy-restore` the production admin is whatever your LOCAL
# admin was (e.g. admin@capbase.dev) — pass ADMIN_EMAIL to match. If it's wrong,
# the rotation lists the ADMIN emails it actually found.
set -euo pipefail

if [ -n "${VPS:-}" ]; then
  REPO="${VPS_REPO:-capbase}"
  echo "==> Rotating on $VPS (repo: $REPO)"
  # Only forward ADMIN_EMAIL when it is actually set: an empty value would beat
  # the env file during compose interpolation and silently target the default.
  exec ssh -t "$VPS" "cd '$REPO' && ${ADMIN_EMAIL:+ADMIN_EMAIL='$ADMIN_EMAIL' }make rotate-admin-password"
fi

[ "$#" -gt 0 ] || {
  echo "❌ No compose command passed. Run this through: make rotate-admin-password"
  exit 1
}

ENVF="${ENVF:-infra/env/all.env}"
[ -f "$ENVF" ] || ENVF=infra/env/app.env
[ -f "$ENVF" ] || { echo "❌ no infra/env/all.env or app.env found"; exit 1; }

# Bounded read then filter — see the note in scripts/gen-secrets.sh for why the
# reverse order (`tr … | head -c`) dies of SIGPIPE under `set -o pipefail`.
randpw() {
  local n="${1:-24}" out=''
  while [ "${#out}" -lt "$n" ]; do
    out="$out$(head -c "$((n * 3))" /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9')"
  done
  printf '%s' "$out" | cut -c "1-$n"
}

NEW_PW="${ADMIN_PASSWORD:-$(randpw 24)}"
sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${NEW_PW}|" "$ENVF"
if [ -n "${ADMIN_EMAIL:-}" ]; then
  sed -i "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=${ADMIN_EMAIL}|" "$ENVF"
fi

echo "==> Rotating admin password via the capbase-api image"
ADMIN_PASSWORD="$NEW_PW" "$@"

cat <<EOF

==> Admin password rotated.

    Email:    $(sed -n 's/^ADMIN_EMAIL=//p' "$ENVF" | tail -1)
    Password: ${NEW_PW}

    ⚠️  SAVE IT NOW — printed once, and $ENVF is gitignored.
EOF
