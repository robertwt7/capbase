#!/usr/bin/env bash
#
# Generates the age keypair used to encrypt production backups. RUN THIS ON YOUR
# LAPTOP, not the VPS — the whole design is that the server can write backups
# but never read them.
#
# Usage: make backup-keygen [IDENTITY=~/.capbase/backup-identity.key]
set -euo pipefail

IDENTITY="${IDENTITY:-$HOME/.capbase/backup-identity.key}"

command -v age-keygen >/dev/null || {
  echo "❌ age-keygen not found."
  echo "   Debian/Ubuntu/WSL: sudo apt-get install -y age"
  echo "   Homebrew:          brew install age"
  echo "   Or:                https://github.com/FiloSottile/age/releases"
  exit 1
}

if [ -f "$IDENTITY" ]; then
  echo "❌ $IDENTITY already exists. Refusing to overwrite — a lost identity means"
  echo "   every backup encrypted to it becomes permanently unreadable."
  echo "   Its public key is:"
  grep '^# public key:' "$IDENTITY" | sed 's/^# public key: /       /'
  exit 1
fi

mkdir -p "$(dirname "$IDENTITY")"
age-keygen -o "$IDENTITY" 2>/dev/null
chmod 600 "$IDENTITY"
PUB="$(grep '^# public key:' "$IDENTITY" | sed 's/^# public key: //')"

cat <<EOF

==> Keypair generated.

    Identity (PRIVATE KEY):  $IDENTITY   [chmod 600]
    Public key:              $PUB

    1. SAVE THE IDENTITY FILE somewhere durable NOW — your password manager, or
       an encrypted drive. It lives OUTSIDE this repo on purpose. Without it,
       every backup encrypted to this key is permanently unrecoverable. There is
       no reset, no recovery, no support channel.

    2. Put the PUBLIC key on the VPS (safe to paste anywhere — it can only
       encrypt, never decrypt):

           ssh <user>@<host> "cd capbase && echo '$PUB' > infra/backup/recipients.txt"

    3. Then, on the VPS:  make deploy-backup-cron

    Restores later use the identity:
        make deploy-backup-verify FILE=…dump.age IDENTITY=$IDENTITY
EOF
