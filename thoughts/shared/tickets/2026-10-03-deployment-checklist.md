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

rclone.conf needs three values from Cloudflare R2. You already have a Cloudflare account, so R2 is the easy choice:

1. In the R2 dashboard, create a bucket named capbase-backups.
2. Go to R2 → Manage API tokens and create a token with Object Read & Write, scoped to that bucket. It gives you an Access Key ID and a Secret Access Key.
3. Note your Account ID. It's shown on the R2 overview page.
4. On the bucket, add a lifecycle rule under Settings → Object lifecycle rules that deletes objects after 30 days.

Then, on the server:

cp infra/backup/rclone.conf.example infra/backup/rclone.conf
chmod 600 infra/backup/rclone.conf

Edit the file and keep only the [offsite] R2 section:

[offsite]
type = s3
provider = Cloudflare
access_key_id = <Access Key ID>
secret_access_key = <Secret Access Key>
endpoint = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
acl = private
no_check_bucket = true

Test the connection with rclone --config infra/backup/rclone.conf lsd offsite:, then run make deploy-backup. The upload goes to offsite:capbase-backups by default, so if you name the bucket something else, set BACKUP_RCLONE_REMOTE in all.env.