#!/usr/bin/env bash
#
# Ships a LOCAL dump into the production database over SSH. Production Postgres
# is loopback-only, so the dump is streamed into the VPS's own container rather
# than dialled directly (which is what `make db-restore-remote` does, and why it
# no longer works against a hardened box).
#
# DESTRUCTIVE: replaces every row in production, INCLUDING the User table.
#
# Usage: make deploy-restore FILE=backups/capbase-….dump VPS=user@host CONFIRM=yes
set -euo pipefail

FILE="${FILE:?FILE= is required, e.g. FILE=backups/capbase-….dump}"
VPS="${VPS:?VPS= is required, e.g. VPS=root@1.2.3.4}"
PGUSER="${PGUSER:-capbase}"
PGDATABASE="${PGDATABASE:-capbase}"
CONTAINER="${PG_CONTAINER:-capbase-postgres}"

[ -f "$FILE" ] || { echo "❌ $FILE not found"; exit 1; }

if [ "${CONFIRM:-}" != "yes" ]; then
  echo "❌ Refusing to overwrite the database on $VPS."
  echo "   This REPLACES every row there, including all User accounts."
  echo "   Re-run with CONFIRM=yes if that is what you want."
  exit 1
fi

echo "==> Streaming $(du -h "$FILE" | cut -f1) into $VPS:$CONTAINER/$PGDATABASE"
# --clean --if-exists: works whether the target is empty or already migrated.
ssh "$VPS" "docker exec -i $CONTAINER pg_restore -U $PGUSER -d $PGDATABASE \
  --clean --if-exists --no-owner --no-privileges" < "$FILE"

echo "==> Row counts on production"
ssh "$VPS" "docker exec $CONTAINER psql -U $PGUSER -d $PGDATABASE -c \
  'SELECT '\''Company'\'' t, count(*) FROM \"Company\"
   UNION ALL SELECT '\''FundingRound'\'', count(*) FROM \"FundingRound\"
   UNION ALL SELECT '\''Investor'\'', count(*) FROM \"Investor\";'"

echo "==> Users now on production (these came from your LOCAL database)"
ssh "$VPS" "docker exec $CONTAINER psql -U $PGUSER -d $PGDATABASE -c \
  'SELECT email, role FROM \"User\" ORDER BY role, email;'"

cat <<EOF

==> Restore complete.

    ⚠️  The restore replaced the User table with YOUR LOCAL USERS — including
        the local admin's password hash. Rotate it before anything else:

            make rotate-admin-password VPS=$VPS ADMIN_EMAIL=<the ADMIN listed above>

    The dump carried _prisma_migrations, so the api container's next boot-time
    'migrate deploy' is a no-op. No seeding needed — SeedHistory came across too.
EOF
