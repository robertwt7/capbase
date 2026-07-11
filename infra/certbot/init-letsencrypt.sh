#!/bin/sh
# One-time Let's Encrypt bootstrap. Prereqs: DNS A record -> this VPS, ports
# 80/443 open, infra/env/app.env filled in (single VPS: infra/env/all.env).
# Run from the repo root (or via `make deploy-tls`). Re-run with FORCE=1 to
# recreate an existing cert.
set -e

# Pick the env file: app.env (split VPS) or all.env (single VPS).
if [ -z "${ENV_FILE:-}" ]; then
  if [ -f infra/env/app.env ]; then ENV_FILE=infra/env/app.env; else ENV_FILE=infra/env/all.env; fi
fi
[ -f "$ENV_FILE" ] || { echo "❌ $ENV_FILE missing — copy the .example and fill it in"; exit 1; }

# Read KEY=value from the env file, stripping inline comments + whitespace.
# (The file is NOT sourced: values like `MAIL_FROM=Capbase <...>` aren't sh.)
env_val() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | sed 's/[[:space:]]*#.*$//; s/[[:space:]]*$//'
}
DOMAIN="${DOMAIN:-$(env_val DOMAIN)}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-$(env_val LETSENCRYPT_EMAIL)}"
: "${DOMAIN:?set DOMAIN in $ENV_FILE}"
: "${LETSENCRYPT_EMAIL:?set LETSENCRYPT_EMAIL in $ENV_FILE}"

compose() {
  docker compose -p capbase -f infra/docker-compose.app.yml --env-file "$ENV_FILE" "$@"
}

CONF=infra/certbot/conf
mkdir -p "$CONF" infra/certbot/www

# Recommended TLS params referenced by the nginx template.
[ -f "$CONF/options-ssl-nginx.conf" ] || curl -sfL \
  https://raw.githubusercontent.com/certbot/certbot/main/certbot-nginx/src/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
  -o "$CONF/options-ssl-nginx.conf"
[ -f "$CONF/ssl-dhparams.pem" ] || curl -sfL \
  https://raw.githubusercontent.com/certbot/certbot/main/certbot/certbot/ssl-dhparams.pem \
  -o "$CONF/ssl-dhparams.pem"

if [ -d "$CONF/live/$DOMAIN" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Cert for $DOMAIN exists. Set FORCE=1 to recreate."
  exit 0
fi

# 1) Dummy cert so nginx can boot on 443.
compose run --rm --entrypoint "sh -c '\
  mkdir -p /etc/letsencrypt/live/$DOMAIN && \
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem -subj /CN=localhost'" certbot
# 2) Start the stack (nginx serves the ACME challenge on :80).
compose up -d --build
# 3) Replace dummy with a real cert via the webroot challenge.
compose run --rm --entrypoint "sh -c '\
  rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf'" certbot
compose run --rm --entrypoint "certbot certonly --webroot -w /var/www/certbot \
  -d $DOMAIN --email $LETSENCRYPT_EMAIL --agree-tos --no-eff-email --non-interactive" certbot
# 4) Reload nginx with the real cert (restart covers a mid-backoff nginx).
compose exec nginx nginx -s reload || compose restart nginx
echo "TLS ready: https://$DOMAIN"
