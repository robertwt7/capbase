#!/usr/bin/env bash
#
# Load or drop the licensed partner snapshot's `partner_stage` schema in the
# capbase database. The schema sits beside `public` (Prisma manages `public`
# only) for the length of the import, then is dropped.
#
# Runs psql INSIDE the Postgres container, as the container's own
# POSTGRES_USER/POSTGRES_DB, so the same script serves the laptop and the VPS
# (on a split topology, run it on the DB box).
#
# Usage: scripts/partner-stage.sh load FILE   (.sql, .sql.gz or .sql.zst)
#        scripts/partner-stage.sh drop
#        scripts/partner-stage.sh status
set -euo pipefail

CONTAINER="${PG_CONTAINER:-capbase-postgres}"
cmd="${1:-}"

docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  echo "❌ Postgres container '$CONTAINER' is not running."
  exit 1
}

psql_in() {
  # shellcheck disable=SC2016 # expanded inside the container, on purpose
  docker exec -i "$CONTAINER" sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' psql "$@"
}

loaded() {
  [ "$(psql_in -tAc "SELECT to_regclass('partner_stage.firm') IS NOT NULL")" = "t" ]
}

case "$cmd" in
  load)
    file="${2:-}"
    [ -n "$file" ] && [ -f "$file" ] || { echo "❌ FILE= must name the stage file (partner-stage-*.sql[.gz|.zst])"; exit 1; }
    if loaded; then
      echo "❌ partner_stage is already loaded. Drop it first: make partner-stage-drop"
      exit 1
    fi
    case "$file" in
      *.zst) reader=(zstd -dc "$file") ;;
      *.gz) reader=(gzip -dc "$file") ;;
      *) reader=(cat "$file") ;;
    esac
    echo "==> Loading $file into schema partner_stage"
    "${reader[@]}" | psql_in
    psql_in -c "ANALYZE partner_stage.firm, partner_stage.fund, partner_stage.company, partner_stage.deal,
                         partner_stage.deal_investor, partner_stage.person, partner_stage.commitment,
                         partner_stage.fund_metric;"
    "$0" status
    ;;
  drop)
    echo "==> Dropping schema partner_stage"
    psql_in -c "DROP SCHEMA IF EXISTS partner_stage CASCADE;"
    ;;
  status)
    if loaded; then
      psql_in -c "SELECT 'firm' AS stage_table, count(*) FROM partner_stage.firm UNION ALL
                  SELECT 'fund', count(*) FROM partner_stage.fund UNION ALL
                  SELECT 'company', count(*) FROM partner_stage.company UNION ALL
                  SELECT 'deal', count(*) FROM partner_stage.deal UNION ALL
                  SELECT 'deal_investor', count(*) FROM partner_stage.deal_investor UNION ALL
                  SELECT 'person', count(*) FROM partner_stage.person UNION ALL
                  SELECT 'commitment', count(*) FROM partner_stage.commitment UNION ALL
                  SELECT 'fund_metric', count(*) FROM partner_stage.fund_metric;"
    else
      echo "partner_stage is not loaded."
    fi
    ;;
  *)
    echo "Usage: $0 load FILE | drop | status"
    exit 1
    ;;
esac
