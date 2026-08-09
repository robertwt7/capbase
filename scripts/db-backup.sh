#!/usr/bin/env bash
#
# Production backup: dump → verify-restore → encrypt → retain → (optional) upload.
#
# Encryption is age PUBLIC-KEY mode: this box holds only the public key, so it
# can write backups but cannot read them. Generate the pair with
# `make backup-keygen` ON YOUR LAPTOP and copy only the public key here.
#
# Usage: make deploy-backup
# Env:   BACKUP_DIR (/var/backups/capbase), BACKUP_KEEP_DAYS (14),
#        BACKUP_VERIFY (1), BACKUP_MIN_FREE_MB (2048), BACKUP_UPLOAD_CMD (unset)
set -euo pipefail

CONTAINER="${PG_CONTAINER:-capbase-postgres}"
PGUSER="${PGUSER:-capbase}"
PGDATABASE="${PGDATABASE:-capbase}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/capbase}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
RECIPIENTS="${BACKUP_RECIPIENTS:-infra/backup/recipients.txt}"
MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-2048}"

command -v age >/dev/null || {
  echo "❌ 'age' is not installed. Debian 12 / Ubuntu 22.04+: apt-get install -y age"
  exit 1
}
[ -f "$RECIPIENTS" ] || {
  echo "❌ $RECIPIENTS missing — it needs your age PUBLIC key (age1…)."
  echo "   Generate the pair on your laptop: make backup-keygen"
  exit 1
}
docker inspect "$CONTAINER" >/dev/null 2>&1 || { echo "❌ $CONTAINER is not running"; exit 1; }

mkdir -p "$BACKUP_DIR"

# Postgres handles a full disk badly — bail out loudly rather than half-writing.
free_mb="$(df -Pm "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
if [ "$free_mb" -lt "$MIN_FREE_MB" ]; then
  echo "❌ Only ${free_mb}MB free on $BACKUP_DIR (need ${MIN_FREE_MB}MB). Refusing to run."
  exit 1
fi

stamp="$(date -u +%Y%m%d-%H%M%S)"
plain="$(mktemp "${TMPDIR:-/tmp}/capbase-${stamp}.XXXXXX.dump")"
scratch=""
cleanup() {
  rm -f "$plain"
  [ -n "$scratch" ] && docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$scratch\" WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> pg_dump $PGDATABASE"
docker exec "$CONTAINER" pg_dump -U "$PGUSER" -d "$PGDATABASE" \
  --format=custom --no-owner --no-privileges > "$plain"

if [ "${BACKUP_VERIFY:-1}" = "1" ]; then
  # An untested backup isn't a backup: restore this dump into a scratch database
  # and count rows. Same throwaway-DB pattern as scripts/verify-fresh-db.sh.
  scratch="capbase_bkverify_$$"
  echo "==> Verifying: restoring into scratch database $scratch"
  docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres \
    -c "CREATE DATABASE \"$scratch\";" >/dev/null
  docker exec -i "$CONTAINER" pg_restore -U "$PGUSER" -d "$scratch" \
    --no-owner --no-privileges < "$plain"

  echo "==> Row counts in the restored copy"
  docker exec "$CONTAINER" psql -U "$PGUSER" -d "$scratch" -c \
    'SELECT '"'"'Company'"'"' t, count(*) FROM "Company"
     UNION ALL SELECT '"'"'FundingRound'"'"', count(*) FROM "FundingRound"
     UNION ALL SELECT '"'"'Investor'"'"', count(*) FROM "Investor"
     UNION ALL SELECT '"'"'User'"'"', count(*) FROM "User";'

  companies="$(docker exec "$CONTAINER" psql -U "$PGUSER" -d "$scratch" -t -A \
    -c 'SELECT count(*) FROM "Company";')"
  [ "$companies" -gt 0 ] || { echo "❌ Restored copy has 0 companies — backup is NOT good."; exit 1; }
fi

out="$BACKUP_DIR/capbase-${stamp}.dump.age"
echo "==> Encrypting to $out"
age -R "$RECIPIENTS" -o "$out" "$plain"
chmod 600 "$out"

echo "==> Pruning encrypted backups older than ${KEEP_DAYS} days"
find "$BACKUP_DIR" -name 'capbase-*.dump.age' -type f -mtime "+${KEEP_DAYS}" -print -delete

if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  echo "==> Off-site upload"
  BACKUP_FILE="$out" sh -c "$BACKUP_UPLOAD_CMD"
fi

echo "==> Backup OK: $(du -h "$out" | cut -f1)  $out"
