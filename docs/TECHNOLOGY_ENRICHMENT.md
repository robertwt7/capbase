# Website technology operations

Company history requires the persistent CONTRIBUTOR or ADMIN role. Disabling Technology never relaxes that authorization rule.

Collection uses the existing jobs process, Postgres due state and ingestion advisory lock. No profile request crawls a site. The original 20-technology catalog describes observable homepage software, not internal purchases or product infrastructure. Only approved, unmerged companies in an explicit company-ID cohort are eligible. Partner provenance is never changed.

## Pilot and rollout

Both switches default off: jobs `TECH_ENRICHMENT_ENABLED=false` and API `TECH_DETAILS_ENABLED=false`. Set `TECH_ENRICHMENT_COMPANY_IDS` to reviewed IDs before either a manual scan or scheduled collection; empty means no eligible sites. `--slug` only narrows that cohort. The cron uses UTC and defaults to five sites hourly with a five-minute run budget. `TECH_ENRICHMENT_SCHEDULE`, `TECH_ENRICHMENT_LIMIT`, `TECH_ENRICHMENT_TIMEOUT_MS`, `TECH_ENRICHMENT_REFRESH_DAYS`, `TECH_ENRICHMENT_USER_AGENT` and `TECH_ENRICHMENT_HEARTBEAT_URL` are explicit settings; see `.env.example`.

The default ceiling is 120 attempts/day before retries and lock skips. A monthly refresh needs at least `ceil(cohort_size / 30)` successful scans/day plus retries. Review oldest overdue work and coverage before expanding the cohort. An ingestion lock skip leaves work due. Completed batches log counters and optionally send a heartbeat; an all-failed source batch separately reports a coverage warning to Sentry. A completion heartbeat alone is not proof of source health.

From the repository root, after building shared packages/generated Prisma:

```sh
make enrich-technologies LIMIT=10 DRY_RUN=1
make enrich-technologies LIMIT=5 SLUG=reviewed-company
make enrich-technologies-prod LIMIT=5 DRY_RUN=1
```

Local targets read `apps/jobs/.env`; deployed targets use the configured deployed Compose stack. A dry-run acquires the same lock and can fetch public websites but writes no scans, observations, citations, cursor state, retries or success heartbeat. The CLI imports no ingestion cron module. Limits are 1..100; per-site requests remain bounded independently of a larger CLI limit.

Before public enablement, audit at least 100 observations from a 100-site cohort, target at least 95% confirmed detections, disable weak signatures, record success/no-detection/blocked rates, latency and memory, and exercise restart/overlap behaviour. Check source evidence for tokens. Then review desktop and 375px profile layouts, links and keyboard focus. Enable API display only after the review. These are rollout gates, not completed by green fixture tests.

## Freshness and evidence

A successful scan refreshes positive observations; a failed scan never advances their date. Successful supported HTML with no signature is `NO_DETECTIONS`; failures, robots denial, unsupported content and blocked pages remain separate operator outcomes. Evidence stores a fixed bounded descriptor and a URL stripped of query/fragment, never complete HTML, cookies, arbitrary headers or script bodies.

Website signals and verified app links expire at read time after 60 days without positive observation, even if jobs stop. Website absence needs two comparable successful scans at least seven days apart under the same rules. Changed/removed rules cannot retire old observations. Old targets disappear immediately after a website change. Collection targets a 30-day refresh; transient retries use 1h, 6h, 24h then 7d with jitter and respect longer Retry-After. Robots/unsupported/invalid targets retry after 30 days.

One oldest-created scan per current owner/target supplies current observations. Duplicate rows kept by merges cannot extend freshness or revive a retirement. Any suppression across the whole owner/target/technology group wins. Company row locks serialize scan creation/results with merge/unmerge, which preserve scan keys, app provenance keys and citation anchors.

## Corrections

Build jobs, then run the isolated CLI from `apps/jobs` with the same `DATABASE_URL` as the data being corrected. Correction operations require a bounded reason, execute under the ingestion lock and write an audit revision. They have no HTTP fetch side effect.

```sh
node dist/backfill-technologies.js --suppress-scan SCAN_ID --technology wordpress --reason 'Reviewed false signature'
node dist/backfill-technologies.js --suppress-scan SCAN_ID --technology wordpress --reason 'Evidence reviewed again' --unsuppress
node dist/backfill-technologies.js --app-link LINK_ID --app-action verify --reason 'Official site and seller identity manually corroborated' --evidence-url https://example.com/identity
node dist/backfill-technologies.js --app-link LINK_ID --app-action suppress --reason 'Transferred product or incorrect association'
node dist/backfill-technologies.js --app-link LINK_ID --app-action unsuppress --reason 'Ownership reviewed again'
```

Technology suppression/unsuppression updates all duplicate observations in the current company/target group. App actions likewise apply across duplicate links for the current company/target/product. Rechecks reject changed ownership/targets; retry with current identity after a merge. Suppression stays authoritative through later positive scans. Public corrections use the existing profile report route; there is no new general contribution queue.

## Apps and patents

Apps are explicit App Store/Google Play links parsed from successfully fetched official homepages. IDs identify products and never drive company merges. Discovered links stay private candidates until an operator verifies identity with evidence, including publisher/agency and transfer checks. No company-name store search or Play scraping is used. Successful website revalidation refreshes an approved link; a still-unverified candidate is never public.

The Apple read-only pilot returned normal responses for ten IDs in two storefronts plus empty controls. The complete metadata presentation/failure contract is unverified, so this release ships verified outgoing links only: no ratings, download estimates, metadata columns or dead metadata job. See `thoughts/shared/research/2026-10-26-company-app-pilot.md`.

Patent tooling is a separate bounded research CLI. EPO credentials were unavailable, so live access/freshness/matching remain unverified and the recommendation is no public patent feature. No production patent table, company identifier, display card or schedule exists. See `thoughts/shared/research/2026-10-26-company-patent-pilot.md`.

## Rollback

Set `TECH_ENRICHMENT_ENABLED=false` to stop collection and `TECH_DETAILS_ENABLED=false` to omit detail data/counts/citations. Keep the additive tables and evidence for diagnosis. Read-time expiry remains effective independently of scheduling. Do not roll back the history authorization rule or reset a working database.
