#!/usr/bin/env bash
#
# Run the company-match repair CLI inside the ALREADY BUILT jobs image on the
# VPS — `make fix-prod` (audit only) and `make repair-company-matches-prod`.
#
#   * no image build and no other service started (`run --rm --no-deps`);
#   * the source bundle and the plan are mounted READ-ONLY, the result
#     directory read-write, each at a fixed container path, so a path with
#     spaces never reaches a shell word-split;
#   * the container runs as the invoking user, so results are private files the
#     operator owns (OUT is created 0700);
#   * REPAIR_TARGET_ID is passed by NAME (`-e REPAIR_TARGET_ID`), never on the
#     command line, or mounted from REPAIR_TARGET_ID_FILE; DATABASE_URL comes
#     from the container's own env file and is never printed.
#
# Inputs (environment, set by make): MODE COMPOSE_STACK SNAPSHOT OUT PLAN RUN
# EXPECT_DB CONFIRM SLUG LIMIT_GROUPS BINDINGS LIMIT_BINDING_BATCHES LABEL
# REPAIR_TARGET_ID | REPAIR_TARGET_ID_FILE
set -euo pipefail

MODE="${MODE:-}"
case "$MODE" in
  audit | plan | apply | verify | rollback | fingerprint) ;;
  *) echo "MODE must be audit | plan | apply | verify | rollback | fingerprint (got '${MODE}')" >&2; exit 2 ;;
esac
[ -n "${COMPOSE_STACK:-}" ] || { echo "COMPOSE_STACK is not set (run through make)" >&2; exit 2; }

# shellcheck disable=SC2206  # COMPOSE_STACK is a command line by design
compose=($COMPOSE_STACK)
run=(run --rm --no-deps -T --user "$(id -u):$(id -g)")
cli=("$MODE")

if [ -n "${SNAPSHOT:-}" ]; then
  [ -f "$SNAPSHOT/manifest.json" ] || { echo "SNAPSHOT is not a source bundle: $SNAPSHOT" >&2; exit 2; }
  run+=(-v "$(cd "$SNAPSHOT" && pwd -P):/repair/source:ro")
  cli+=(--snapshot /repair/source)
fi
if [ -n "${PLAN:-}" ]; then
  [ -f "$PLAN" ] || { echo "PLAN not found: $PLAN" >&2; exit 2; }
  run+=(-v "$(cd "$(dirname "$PLAN")" && pwd -P):/repair/plan:ro")
  cli+=(--plan "/repair/plan/$(basename "$PLAN")")
fi
if [ -n "${OUT:-}" ]; then
  mkdir -p "$OUT"
  chmod 0700 "$OUT"
  run+=(-v "$(cd "$OUT" && pwd -P):/repair/out")
  cli+=(--out /repair/out)
fi
if [ -n "${REPAIR_TARGET_ID_FILE:-}" ]; then
  [ -f "$REPAIR_TARGET_ID_FILE" ] || { echo "REPAIR_TARGET_ID_FILE not found" >&2; exit 2; }
  run+=(-v "$(cd "$(dirname "$REPAIR_TARGET_ID_FILE")" && pwd -P)/$(basename "$REPAIR_TARGET_ID_FILE"):/repair/target-id:ro")
  cli+=(--target-id-file /repair/target-id)
elif [ -n "${REPAIR_TARGET_ID:-}" ]; then
  export REPAIR_TARGET_ID
  run+=(-e REPAIR_TARGET_ID)
fi
for pair in "run:${RUN:-}" "expect-db:${EXPECT_DB:-}" "confirm:${CONFIRM:-}" "slug:${SLUG:-}" \
  "limit-groups:${LIMIT_GROUPS:-}" "bindings:${BINDINGS:-}" "limit-binding-batches:${LIMIT_BINDING_BATCHES:-}" \
  "label:${LABEL:-}"; do
  name="${pair%%:*}"
  value="${pair#*:}"
  [ -n "$value" ] && cli+=("--$name" "$value")
done

exec "${compose[@]}" "${run[@]}" jobs node apps/jobs/dist/company-match-repair.js "${cli[@]}"
