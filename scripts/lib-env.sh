# shellcheck shell=bash
# Shared helpers for the ops scripts. Sourced, not executed.
#
# The deploy env file is NOT shell (values like `MAIL_FROM=Capbase <...>`), so it
# is never sourced. `load_env_keys` reads named keys out of it instead; a value
# already in the process environment wins, so `BACKUP_VERIFY=0 make …` works.

# Single VPS → all.env; split → app.env (same detection as the Makefile).
deploy_env_file() {
  if [ -n "${ENVF:-}" ]; then echo "$ENVF"
  elif [ -f infra/env/app.env ]; then echo infra/env/app.env
  else echo infra/env/all.env
  fi
}

# Read KEY's value from the env file, dropping ` # comments` and trailing space.
env_file_val() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^$key=//p" "$file" | tail -n 1 | sed 's/[[:space:]]\{1,\}#.*$//; s/[[:space:]]*$//'
}

# load_env_keys FILE KEY… — export each KEY from FILE unless already set.
load_env_keys() {
  local file="$1" key val
  shift
  for key in "$@"; do
    if [ -z "${!key:-}" ]; then
      val="$(env_file_val "$file" "$key")"
      [ -n "$val" ] && export "$key=$val"
    fi
  done
  return 0
}
