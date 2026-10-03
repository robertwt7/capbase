# Production deployment checklist (single VPS, Flow A)

Full detail: `infra/README.md`. `[L]` = laptop, `[V]` = VPS.

1. [L] `make backup-keygen` — save `~/.capbase/backup-identity.key` in your password manager.
2. [L] DNS: `capbase.fyi` (and `errors.capbase.fyi` if using GlitchTip) A record → VPS IP.
3. [V] Install Docker Engine + compose plugin; open ports 22/80/443 only.
4. [V] `git clone … && cd capbase`
5. [V] `make deploy-secrets` — generates `infra/env/all.env`.
6. [V] Edit `infra/env/all.env`: `LETSENCRYPT_EMAIL`, `SEC_USER_AGENT`, `NEXT_PUBLIC_GA_ID`, `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET`, `RESEND_API_KEY`, `OPS_ALERT_EMAIL`.
7. [V] `make deploy-all` (not `make up` — that's the local dev stack). Add 4 GB swap first (`infra/README.md` → Tuning).
8. [V] `make deploy-tls`
9. [L] `make db-dump-prod`
10. [L] `make deploy-restore FILE=backups/capbase-prod-….dump VPS=user@host CONFIRM=yes`
11. [L] `make rotate-admin-password VPS=user@host` — save the printed password.
12. [V] Backups: `echo 'age1…' > infra/backup/recipients.txt`, `apt-get install -y age rclone`, fill `infra/backup/rclone.conf`, `make deploy-backup`, `make deploy-backup-cron` (nightly 03:00). Add a ~30-day lifecycle rule on the R2/B2 bucket — off-site copies are never pruned.
13. [V] Optional (tight on 4 GB — skip for the MVP): `make deploy-glitchtip-init`, then put the DSNs in `all.env` and re-run `make deploy-all`.
14. [V] `make deploy-doctor`, then smoke-test https://capbase.fyi, `/admin` login and the GA consent banner.
15. Set up an external uptime monitor on `https://capbase.fyi/api/health`.

Changing `all.env` later: edit it, then re-run `make deploy-all` to recreate the containers with the new values.
