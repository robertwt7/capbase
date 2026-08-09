#!/usr/bin/env bash
# Read-only health report for the single-VPS deployment: `make deploy-doctor`.
set -uo pipefail

echo "=== Disk ==="
# Keep the header first, drop the duplicate row when / and BACKUP_DIR share a
# filesystem (which they do on a stock single VPS).
df -h / "${BACKUP_DIR:-/var/backups/capbase}" 2>/dev/null | awk 'NR==1 || !seen[$0]++'

echo; echo "=== Postgres data volume ==="
docker system df -v 2>/dev/null | grep -E 'VOLUME NAME|capbase-pgdata' || echo "  (volume not found)"

echo; echo "=== Container health ==="
docker ps --filter 'name=capbase-' --format 'table {{.Names}}\t{{.Status}}'

echo; echo "=== Docker log sizes (cap is max-size × max-file per container) ==="
sudo du -ch /var/lib/docker/containers/*/*-json.log 2>/dev/null | tail -1 || echo "  (needs sudo)"

echo; echo "=== Postgres exposure (want 127.0.0.1 only) ==="
ss -tlnp 2>/dev/null | grep ':5432' || echo "  not listening on the host at all — good"

echo; echo "=== Newest backup ==="
ls -lt "${BACKUP_DIR:-/var/backups/capbase}"/capbase-*.dump.age 2>/dev/null | head -1 \
  || echo "  ⚠️  NO BACKUPS FOUND — run: make deploy-backup-cron"
