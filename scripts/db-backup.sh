#!/usr/bin/env bash
#
# Production backup: dump → verify-restore → encrypt → retain → off-site upload.
#
# Encryption is age PUBLIC-KEY mode: this box holds only the public key, so it
# can write backups but cannot read them. Generate the pair with
# `make backup-keygen` ON YOUR LAPTOP and copy only the public key here.
#
# Off-site: with infra/backup/rclone.conf present, every encrypted dump is
# copied to BACKUP_RCLONE_REMOTE (default `offsite:capbase-backups`); the
# bucket's lifecycle rule handles retention there. BACKUP_UPLOAD_CMD remains as
# an escape hatch for anything rclone can't do ($BACKUP_FILE is set for it).
#
# Any failure — including the upload — exits non-zero AND raises an alert via
# scripts/notify-failure.sh (GlitchTip and/or email), because a cron job that
# fails silently is how you find out you have no backups on the day you need one.
#
# Usage: make deploy-backup            (BACKUP_TAG=predeploy names the file)
# Env:   BACKUP_DIR (/var/backups/capbase), BACKUP_KEEP_DAYS (14),
#        BACKUP_VERIFY (1), BACKUP_MIN_FREE_MB (2048), BACKUP_RCLONE_REMOTE,
#        BACKUP_UPLOAD_CMD — read from the environment, else infra/env/all.env.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=lib-env.sh
. scripts/lib-env.sh
load_env_keys "$(deploy_env_file)" BACKUP_DIR BACKUP_KEEP_DAYS BACKUP_VERIFY \
  BACKUP_MIN_FREE_MB BACKUP_RCLONE_REMOTE BACKUP_UPLOAD_CMD POSTGRES_USER POSTGRES_DB

# Keep a copy of this run's output for the failure alert.
runlog="$(mktemp "${TMPDIR:-/tmp}/capbase-backup-run.XXXXXX.log")"
exec > >(tee -a "$runlog") 2>&1

CONTAINER="${PG_CONTAINER:-capbase-postgres}"
PGUSER="${PGUSER:-${POSTGRES_USER:-capbase}}"
PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-capbase}}"
RCLONE_CONF="${BACKUP_RCLONE_CONFIG:-infra/backup/rclone.conf}"
REMOTE="${BACKUP_RCLONE_REMOTE:-offsite:capbase-backups}"

plain=""
scratch=""
cleanup() {
  local status=$?
  [ -n "$plain" ] && rm -f "$plain"
  [ -n "$scratch" ] && docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$scratch\" WITH (FORCE);" >/dev/null 2>&1 || true
  if [ "$status" -ne 0 ]; then
    echo "❌ Backup FAILED (exit $status)"
    scripts/notify-failure.sh "backup" "db-backup.sh exited $status" "$runlog" || true
  fi
  rm -f "$runlog"
}
trap cleanup EXIT

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

out="$BACKUP_DIR/capbase-${BACKUP_TAG:+${BACKUP_TAG}-}${stamp}.dump.age"
echo "==> Encrypting to $out"
age -R "$RECIPIENTS" -o "$out" "$plain"
chmod 600 "$out"

echo "==> Pruning encrypted backups older than ${KEEP_DAYS} days"
find "$BACKUP_DIR" -name 'capbase-*.dump.age' -type f -mtime "+${KEEP_DAYS}" -print -delete

uploaded=""
if [ -f "$RCLONE_CONF" ]; then
  command -v rclone >/dev/null || {
    echo "❌ $RCLONE_CONF exists but rclone is not installed (apt-get install -y rclone)"; exit 1; }
  dest="$REMOTE/$(basename "$out")"
  echo "==> Off-site upload → $dest"
  # --immutable: never overwrite an object that is already there.
  rclone --config "$RCLONE_CONF" copyto --immutable "$out" "$dest"
  # Trust, but verify: the object must exist with the same size.
  remote_size="$(rclone --config "$RCLONE_CONF" size --json "$dest" | python3 -c 'import json,sys; print(json.load(sys.stdin)["bytes"])')"
  local_size="$(stat -c %s "$out")"
  [ "$remote_size" = "$local_size" ] || {
    echo "❌ Off-site copy is $remote_size bytes, local is $local_size"; exit 1; }
  uploaded="$dest"
fi
if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  echo "==> Off-site upload (BACKUP_UPLOAD_CMD)"
  BACKUP_FILE="$out" sh -c "$BACKUP_UPLOAD_CMD"
  uploaded="${uploaded:-BACKUP_UPLOAD_CMD}"
fi
[ -n "$uploaded" ] || echo "⚠️  No off-site copy: add infra/backup/rclone.conf (see rclone.conf.example)."

echo "==> Backup OK: $(du -h "$out" | cut -f1)  $out"
