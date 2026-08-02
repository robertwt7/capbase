# Rebuilding the dataset from scratch

Every row Capbase publishes is derived from a free, public, redistributable
source. Nothing is hand-curated, so the whole database can be rebuilt from an
empty Postgres with the commands below — locally or on production.

## What comes from where

| Source | Produces | Cadence | Volume (Aug 2026) |
|---|---|---|---|
| `SEC_EDGAR` | Companies + funding rounds + people, from Form D filings | Daily index; walk N days | 4.8k companies, 5.3k rounds |
| `WIKIDATA` | Company metadata, investors, founders/CEOs, acquisitions, exits, **and** ~640 investor firms enumerated by `P31` class | Snapshot; changes slowly | 6.3k companies, ~1.5k investor edges |
| `SEC_ADV` | **Investor firms only** (VC/PE), from the monthly Investment Adviser bulk files | Monthly full snapshot | ~7.0k firms |

Two properties make this reproducible:

- **Every ingested row carries provenance** — `externalSource` + `externalId`, with
  a `@@unique` on the pair. Re-running a source updates rows in place instead of
  duplicating them, so all the commands below are safe to repeat.
- **Ingested rows are auto-`APPROVED`**; only human contributions enter the
  moderation queue. A rebuild therefore produces a fully public dataset with no
  manual step.

**What no free source provides:** investor→portfolio-company edges at scale.
Form D discloses the issuer and its officers, never who bought; Form ADV
discloses a firm's funds and service providers, never its portfolio. Wikidata's
~1,500 `P1951` edges are the realistic automated ceiling. Everything beyond that
is crowdsourced — which is why investor profiles with an empty portfolio render a
"contribute" empty state rather than being hidden.

## Full rebuild, local

```bash
make db-up            # start Postgres and apply all migrations
make db-seed          # admin user (+ demo data when SEED_DEMO=true)
make ingest-all       # every source, then backfill sectors
```

`make ingest-all` accepts `DAYS=` to size the SEC Form D window (default 3650,
i.e. ten years). A ten-year Form D walk takes hours because of the 10 req/s SEC
rate limit; use `DAYS=90` for a quick, representative dataset.

## Full rebuild, production

```bash
make deploy-db                 # Postgres (migrations run on api container boot)
make deploy-seed               # admin user
make ingest-prod DAYS=3650 LIMIT=1000000 SOURCE=SEC_EDGAR
make ingest-investors-prod     # SEC_ADV + Wikidata investor firms
make ingest-prod DAYS=1 LIMIT=1000000 SOURCE=WIKIDATA
make backfill-sectors-prod
```

Migrations are applied automatically by the api container (`prisma migrate
deploy`), including the `add_investor_entity` data steps — the EIB purge and the
investor backfill run exactly once, wherever they are applied.

## Just the investors

```bash
make ingest-investors          # local
make ingest-investors-prod     # in the jobs container
```

Takes roughly a minute: two ZIP downloads plus one SPARQL sweep.

## Reproducing a specific snapshot

SEC Form ADV is republished monthly and the SEC keeps prior months online, so a
run can be pinned to an exact snapshot:

```bash
ADV_SNAPSHOT=ia07012026 make ingest SOURCE=SEC_ADV LIMIT=1000000 DAYS=1
```

Every run logs the snapshot it resolved and the two URLs it fetched, so any
past run can be reproduced from its logs:

```
[AdvClient] ADV snapshot ia07012026 (latest): https://…/ia07012026.zip + https://…/ia07012026-exempt.zip
```

Leave `ADV_SNAPSHOT` unset to always track the newest month. Note the published
filenames are **not** pattern-stable (`ia07012026.zip`, `ia060126_0.zip`,
`ia020226-exemptzip.zip` all appear on one page), so the client scrapes the index
page for links rather than constructing a URL from a date.

`SEC_EDGAR` is pinned by its `DAYS` window; `WIKIDATA` is live and cannot be
pinned — it reflects Wikidata at the moment of the run.

## Verifying a rebuild

```sql
-- Investor universe, by type.
SELECT type, count(*) FROM "Investor" GROUP BY type ORDER BY 2 DESC;

-- Must be zero: the EIB is a development lender, not an equity investor.
SELECT count(*) FROM "InvestorHolding" WHERE name = 'European Investment Bank';

-- Must be zero: every holding resolves to a first-class Investor.
SELECT count(*) FROM "InvestorHolding" WHERE "investorId" IS NULL;

-- Must be zero: a shared domain would merge unrelated firms (see util/domain.ts).
SELECT domain, count(*) FROM "Investor"
WHERE domain IS NOT NULL GROUP BY domain HAVING count(*) > 1
ORDER BY 2 DESC LIMIT 10;
```

Expected shape after a full rebuild (August 2026 sources):

| Table | Rows |
|---|---|
| `Company` | ~11,000 |
| `FundingRound` | ~5,300 |
| `Investor` | ~7,400 |
| `InvestorHolding` | ~1,150 |

## Gotchas

- **SEC rate limit** — 10 req/s per IP across every `sec.gov` host, and a
  descriptive `SEC_USER_AGENT` with a contact email is mandatory. Both clients
  throttle to ~6 req/s; do not run two backfills against SEC at once.
- **The ADV files are latin-1**, not UTF-8. Decoding them as UTF-8 mangles firm
  names.
- **`make db-reset` is destructive** and re-runs every seed phase. It does not
  re-ingest — follow it with `make ingest-all`.
- **A Form D ten-year walk is long.** It is the only slow step; the investor
  sources finish in about a minute.
