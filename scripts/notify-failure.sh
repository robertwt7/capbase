#!/usr/bin/env bash
#
# Raise an alarm about a failed ops job (nightly backup, …). Best effort: it
# never fails itself, and it tries every channel that is configured:
#
#   • GlitchTip — an error event via the Sentry store API, to OPS_SENTRY_DSN
#     (falls back to JOBS_SENTRY_DSN, so it lands next to failed ingests).
#   • Email     — through Resend's API to OPS_ALERT_EMAIL, using RESEND_API_KEY
#     and MAIL_FROM.
#
# Values come from the environment, else from the deploy env file.
# Usage: scripts/notify-failure.sh "<job>" "<one-line summary>" [log file]
set -uo pipefail

cd "$(dirname "$0")/.." || exit 0
# shellcheck source=lib-env.sh
. scripts/lib-env.sh
load_env_keys "$(deploy_env_file)" OPS_SENTRY_DSN JOBS_SENTRY_DSN OPS_ALERT_EMAIL RESEND_API_KEY MAIL_FROM

job="${1:-ops job}"
summary="${2:-failed}"
log="${3:-}"
host="$(hostname)"
tail_text=""
[ -n "$log" ] && [ -f "$log" ] && tail_text="$(tail -n 40 "$log")"

# JSON-escape via python3 (present on every stock Debian/Ubuntu image).
json_str() { python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'; }

sent=0
dsn="${OPS_SENTRY_DSN:-${JOBS_SENTRY_DSN:-}}"
if [ -n "$dsn" ]; then
  # https://<key>@<host>/<project>  →  https://<host>/api/<project>/store/
  if [[ "$dsn" =~ ^(https?)://([^@]+)@([^/]+)/([0-9]+)$ ]]; then
    scheme="${BASH_REMATCH[1]}" key="${BASH_REMATCH[2]}" dhost="${BASH_REMATCH[3]}" project="${BASH_REMATCH[4]}"
    message="$(printf '%s failed on %s: %s' "$job" "$host" "$summary" | json_str)"
    extra="$(printf '%s' "$tail_text" | json_str)"
    body="{\"message\":$message,\"level\":\"error\",\"platform\":\"other\",\"logger\":\"ops\",\"server_name\":\"$host\",\"tags\":{\"job\":$(printf '%s' "$job" | json_str)},\"extra\":{\"log_tail\":$extra}}"
    if curl -fsS -m 15 -X POST "$scheme://$dhost/api/$project/store/" \
      -H 'Content-Type: application/json' \
      -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_key=$key, sentry_client=capbase-ops/1.0" \
      -d "$body" >/dev/null; then
      sent=1; echo "==> Alert sent to GlitchTip"
    else
      echo "⚠️  Could not reach GlitchTip"
    fi
  else
    echo "⚠️  OPS_SENTRY_DSN/JOBS_SENTRY_DSN is not a DSN — skipping GlitchTip"
  fi
fi

if [ -n "${OPS_ALERT_EMAIL:-}" ] && [ -n "${RESEND_API_KEY:-}" ]; then
  subject="$(printf '[capbase] %s failed on %s' "$job" "$host" | json_str)"
  text="$(printf '%s\n\n%s\n' "$summary" "$tail_text" | json_str)"
  from="$(printf '%s' "${MAIL_FROM:-Capbase <onboarding@resend.dev>}" | json_str)"
  to="$(printf '%s' "$OPS_ALERT_EMAIL" | json_str)"
  if curl -fsS -m 15 -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' \
    -d "{\"from\":$from,\"to\":[$to],\"subject\":$subject,\"text\":$text}" >/dev/null; then
    sent=1; echo "==> Alert emailed to $OPS_ALERT_EMAIL"
  else
    echo "⚠️  Could not send the alert email"
  fi
fi

[ "$sent" = 1 ] || echo "⚠️  No alert channel configured (set JOBS_SENTRY_DSN or OPS_ALERT_EMAIL + RESEND_API_KEY)"
exit 0
