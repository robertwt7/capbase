#!/usr/bin/env bash
#
# Snapshot the database right before a deploy recreates the api container —
# which runs `prisma migrate deploy` on boot. A migration that goes wrong is
# then a restore of a minutes-old dump, not of last night's.
#
# Called by `make deploy-all` between building the images and starting them.
# Skips on a first deploy (no database yet). Refuses to continue when backups
# aren't set up, unless SKIP_BACKUP=1 says that is a conscious choice.
set -euo pipefail

cd "$(dirname "$0")/.."
CONTAINER="${PG_CONTAINER:-capbase-postgres}"

if [ "${SKIP_BACKUP:-0}" = "1" ]; then
  echo "⚠️  SKIP_BACKUP=1 — deploying without a pre-migrate backup"
  exit 0
fi
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != "true" ]; then
  echo "==> $CONTAINER not running (first deploy?) — no pre-migrate backup"
  exit 0
fi
if [ ! -f "${BACKUP_RECIPIENTS:-infra/backup/recipients.txt}" ]; then
  echo "❌ Backups aren't set up (infra/backup/recipients.txt missing), so this deploy"
  echo "   would migrate the database with no way back. Set them up (make backup-keygen,"
  echo "   see infra/README.md → Backups) or re-run with SKIP_BACKUP=1."
  exit 1
fi

echo "==> Pre-migrate backup"
BACKUP_TAG=predeploy scripts/db-backup.sh
