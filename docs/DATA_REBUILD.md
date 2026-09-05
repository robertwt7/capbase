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
| `SEC_ADV_FUNDS` | **Private funds only** — one row per fund a firm reports on Form ADV Schedule D 7.B.(1), with its type and gross assets | Frozen archive cut; re-cut occasionally | ~95k funds across ~5.5k managers |
| `SEC_FORM_C` | Regulation Crowdfunding issuers + their raises + signing officers, from the quarterly Form C data sets | 41 quarterly snapshots (2016Q2→) | 9.0k issuers, 4.3k rounds, 19.6k people |
| `SBIR` | Deep-tech companies + their federal research awards (`kind: 'Grant'`), from the monthly SBIR.gov bulk file | Monthly full snapshot | 15.3k companies, 124k grant rounds ($56bn) |
| `SEC_S1` | **Investor→company edges only**, from S-1 principal-stockholder tables | Document walk from `S1_START_DATE` | ~1,000 filings/year |

Two properties make this reproducible:

- **Every ingested row carries provenance** — `externalSource` + `externalId`, with
  a `@@unique` on the pair. Re-running a source updates rows in place instead of
  duplicating them, so all the commands below are safe to repeat.
- **Ingested rows are auto-`APPROVED`**; only human contributions enter the
  moderation queue. A rebuild therefore produces a fully public dataset with no
  manual step.

**Where investor→portfolio-company edges come from.** Form D discloses the issuer
and its officers, never who bought; Form ADV discloses a firm's funds and service
providers, never its portfolio. Two sources do disclose edges: Wikidata's ~1,500
`P1951` statements, and **S-1 principal-stockholder tables**, which name the firms
that own a company about to register securities. `SEC_S1` publishes an edge only
when the holder resolves to a firm already in the investor universe — an ownership
table gives no type signal at all (a row can be a VC fund, a corporate parent, a
family trust or a founder), and `InvestorType` must come from source structure,
never from a name. Everything beyond those two is crowdsourced, which is why an
investor profile with an empty portfolio renders a "contribute" empty state rather
than being hidden.

**Form C proceeds are text-extracted, and an offering without one gets no round.**
The crowdfunding data sets publish the *target* and *maximum* offering amounts as
columns and never the proceeds; the money that actually arrived appears as prose on
a `C-U` progress update ("has raised a total of $119,700."). About 88% of C-U
filings yield an amount; the rest are honest misses — "Offering closed
unsuccessfully", "End of offering" — and those offerings contribute the issuer's
metadata and officers but **no funding round**. Printing a target as though it were
proceeds would make ~6,000 offerings look funded that never closed.

**SBIR awards are grants, and grants are not raises.** Every SBIR/STTR round lands
with `kind: 'Grant'` and the firm's `totalRaisedUsd` set to `0`. Grants are real
capital events and render on the company's funding ladder with a `Grant` tag, but
`MarketService` excludes them from the market tape's deal count, and the tape's
raised total sums `Company.totalRaisedUsd`, which SBIR never writes. Without that,
adding SBIR would have moved the deal count from 9,880 to 134,359 and silently
absorbed $56bn of federal money into "capital raised".

**Funds come from two SEC sources and neither is sufficient alone.** Form ADV
Schedule D 7.B.(1) names each private fund a filer reports and gives its type and
gross asset value — but Form ADV never asks when a fund was raised or how much it
targeted, so it supplies **no vintage and no fund size**. Pooled-fund Form D
filings supply exactly those (`yearOfInc`, `totalOfferingAmount`,
`totalAmountSold`) but **never name the manager** — a fund's Form D lists the GP's
individuals, not the firm. The two are joined on the fund's own name, which works
for about 35% of pooled filings in the years the ADV archive covers.

Four consequences worth knowing before reading the numbers:

- **The ADV archive is frozen at 2011-11-05 → 2024-12-31** and is re-cut only
  occasionally. A fund that closed in 2025 or 2026 has a Form D but no ADV row, so
  it is skipped until the SEC publishes the next cut. `ADV_ARCHIVE=` pins a cut for
  a reproducible run; every run logs the label and both URLs it resolved.
- **A pooled Form D with no matching ADV fund is dropped, not attached to a guessed
  manager.** Prefix-matching the fund's name against the investor index was measured
  at +0.8% coverage and its very first hit was a false positive (`Venture Capital
  Portfolio TE 2023 LP` → an `Investor` row literally named "venture capital").
  Every `Fund.managerId` is structural or the row does not exist.
- **A fund name claimed by two different managers matches neither.** 191 of 94,399
  normalized ADV fund names collide, and they are degenerate (`fund 5`, `fund b`,
  `94`); since a Form D filing carries no manager to disambiguate with, an ambiguous
  name must resolve to nothing.
- **AngelList-style SPV platforms are tens of thousands of the rows.** "Platform
  Advisor, LLC" (CRD 167700) alone reports 22,277 funds named `AL-<COMPANY>-FUND,
  LLC`, some with gross assets of $101; Gaingels, Alumni Ventures, EquityBee and
  Microangel are the same shape. They are genuinely reported private funds and a
  size floor would discard real small funds too, so they are all ingested and
  handled in presentation — fund lists sort by gross assets and paginate.

Also note that `Gross Asset Value` is **NAV as of the filing, not capital raised**.
It sits in its own column (`grossAssetsUsd`) precisely so it is never read as a
fund size.

## Full rebuild, local

```bash
make db-up            # start Postgres and apply all migrations
make db-seed          # admin user (+ demo data when SEED_DEMO=true)
make ingest-all       # every source, then backfill sectors
```

`make ingest-all` accepts `DAYS=` to size the SEC Form D window (default 3650,
i.e. ten years). A ten-year Form D walk takes hours because of the 10 req/s SEC
rate limit; use `DAYS=90` for a quick, representative dataset.

**The order inside `ingest-all` is forced, not stylistic.** `SEC_ADV` runs first
because a fund with no manager in the `Investor` table is dropped; `SEC_ADV_FUNDS`
runs next because the Form D walk can only date and size a fund that has already
been named. Running the Form D walk first still produces every company and round —
it just contributes no vintages.

**Turn revision recording off for a full rebuild.** Ingest normally writes a
public `Revision` whenever it changes an already-published company field, so the
profile timeline attributes the change to its source. A rebuild creates the
entire corpus at once, and a "history" of that creation is noise, not signal —
and it is the slowest possible time to be writing it. Prefix the rebuild with
`INGEST_RECORD_REVISIONS=false`:

```bash
INGEST_RECORD_REVISIONS=false make ingest-all
```

Leave it at its default (`true`) for the daily cron and for incremental
backfills against a live dataset, where the changes are real edits to published
figures.

## Identifiers

`make backfill-identifiers` (a step of `make ingest-all`, just before citations)
populates the `EntityIdentifier` crosswalk — the table that lets a Capbase row be
joined to anything else, and that gives ingest a match key stronger than a
normalized name. Like the citation backfill it touches **no network**: every
value is derived from a column already on the row (the `externalId` that *is* a
CIK for the SEC sources and a QID for Wikidata, the `uei:`/`duns:` prefix SBIR
keys firms on, `crdNumber`/`cikNumber` on investors, and `domain` on both).

Two rules make it safe to re-run and safe to trust:

- A value that fails validation is **counted and skipped, never stored**. A
  malformed identifier in the crosswalk would join two unrelated entities, which
  is worse than having no identifier. An SBIR firm keyed on a normalized name
  (`name:…`) therefore contributes nothing, which is correct — a name is not an
  identifier.
- A value already held by a **different row of the same type** is not overwritten.
  That collision is exactly the duplicate the merge queue exists for, so it
  records a `MergeCandidate` with `signal='identifier'` and moves on. Because
  the table is unique per `(scheme, value, entityType)`, a collision can never
  land in it — the failed write is the only moment it is visible, which is why
  detection happens here rather than in a later scan.

Uniqueness is **per entity type, not global**. Four domains, two CIKs and one QID
are held by a company row and an investor row at the same time (Wefunder,
Republic, Shadow, Red Cell) — one organisation that both raises and invests, not
a duplicate. A global unique would reject that legitimate data on the first run.

Run it before `backfill-citations` and before `make merge-candidates`, which
reads what it wrote.

## Merge candidates

`make merge-candidates` proposes duplicate pairs into the `/admin/merges` queue.
It covers only the two **weak** signals, a shared domain and a shared normalized
name. The identifier signal is deliberately absent: `EntityIdentifier` is unique
per `(scheme, value, entityType)`, so a duplicate identifier can never land in
the table and there is nothing for a scan to find — `writeIdentifier` records
those candidates at the instant the write fails, which is the only moment they
are visible.

The name key is **looser than the one ingest matches on**, and has to be. A
sweep keyed on `normalizeName` can only find pairs `upsertCompany` would already
have merged, and measured on the live corpus it finds zero. The detector's key
replaces punctuation with a space where the matcher deletes it, so
`HeavyTech,Inc.` and `HeavyTech, Inc.` meet here and nowhere else: 5 groups over
10 rows today.

Groups larger than 8 rows are skipped and logged rather than queued — a name
shared by nine rows is a generic string, and one such group would put 36 pairs
in front of a moderator. Re-runnable: `recordCandidate` orders each pair
canonically, upgrades a weak signal to a stronger one but never the reverse, and
leaves a pair an admin already decided alone, so a rejection is never
re-proposed.

## Citations

`make backfill-citations` (the last step of `make ingest-all`) mints the
`Source` and `Citation` rows that put a source link next to every ingested fact.
It touches no network: every URL is *constructed* from identifiers the rows
already carry — CIK + accession for a Form D filing, the QID for Wikidata, the
CRD for Form ADV, the EDGAR file number for a Reg CF offering, the filer's CIK for
a Form C or S-1 company. It is idempotent, so re-run it after any incremental
ingest to cite the newly created rows.

SBIR rows are the one case with no per-row public page: the bulk award file has no
per-award URL that can be derived from what it publishes. Those rows cite **the
dataset itself**, with the award's contract number as the citation's reference.
That is honest — the file *is* the document the fact came from — and it is the
same rule as everywhere else: a guessed award URL would be worse than none.

A row is skipped (and counted in the run's log) when no URL can be derived — most
often a SEC round whose company was created by a different source, so there is no
CIK to build the archive path from. A wrong link is worse than no link on a
feature whose whole purpose is traceability.

## Full rebuild, production

```bash
make deploy-all                # whole stack incl. Postgres (migrations run on api boot)
make deploy-seed               # admin user
make ingest-prod DAYS=1 LIMIT=1000000 SOURCE=SEC_ADV        # managers first…
make ingest-funds-prod                                     # …then their funds…
make ingest-prod DAYS=3650 LIMIT=1000000 SOURCE=SEC_EDGAR  # …then vintages/sizes
make ingest-prod DAYS=1 LIMIT=1000000 SOURCE=WIKIDATA
make ingest-prod DAYS=1 LIMIT=1000000 SOURCE=SEC_FORM_C
make ingest-prod DAYS=1 LIMIT=1000000 SOURCE=SBIR
make ingest-prod DAYS=1 LIMIT=1000000 SOURCE=SEC_S1
make backfill-sectors-prod
make backfill-identifiers-prod  # the CIK/QID/CRD/UEI crosswalk
make merge-candidates-prod      # propose duplicate pairs for the admin queue
make backfill-citations-prod    # source links for every ingested row
```

This is "Flow B" in [`infra/README.md`](../infra/README.md); `make deploy-all` is
the single-VPS command (`make deploy-db` is the split-topology equivalent).
`deploy-seed` refuses to run with a weak `ADMIN_PASSWORD`.

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

The per-fund Schedule D detail is a different, larger publication — the Form ADV
Part 1 data archives on the SEC's FOIA page — re-cut occasionally rather than
monthly, with the range it covers in the filename. Pin one the same way:

```bash
ADV_ARCHIVE=20111105-20241231 make ingest SOURCE=SEC_ADV_FUNDS LIMIT=1000000 DAYS=1
```

Those archives are 700 MB and 429 MB; the source reads the four members it needs
(~180 MB compressed) by HTTP range request, never downloading either archive.

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

## Shipping the local dataset to production

Re-ingesting on prod (above) is the canonical path — every row is reproducible, and
it costs nothing but time. Copying the local database is the *fast* path: it takes
about a minute instead of hours of throttled SEC requests, and it guarantees prod
matches exactly what you have been looking at locally.

```bash
make db-dump                                    # → backups/capbase-<utc-stamp>.dump (~2.5 MB)
make deploy-restore \
  FILE=backups/capbase-20260802-225820.dump \
  VPS=user@host \
  CONFIRM=yes
make rotate-admin-password VPS=user@host ADMIN_EMAIL=admin@capbase.dev   # ← NOT optional
```

`deploy-restore` streams the dump over SSH into the VPS's **own** Postgres
container. Production Postgres is bound to `127.0.0.1`, so nothing dials it from
outside — which is also why `make db-restore-remote` (it connects to a
`URL=` from the *local* container) no longer reaches a hardened production box.
`db-restore-remote` stays for tunnelled or split-topology targets.

- The dump is `-Fc` (custom format, compressed) and includes `_prisma_migrations`,
  so after a restore the api container's `prisma migrate deploy` on boot is a
  no-op — migration history arrives intact.
- The restore uses `--clean --if-exists`, so it works whether the target is empty
  or already migrated/populated.
- **It is destructive**: every row in the target is replaced, including `User`
  accounts. It refuses to run without `CONFIRM=yes`.
- **Rotating the admin password afterwards is mandatory.** The dump carries your
  local `User` rows, so production's admin login becomes whatever your dev box
  used — and the admin is `admin@capbase.dev`, not the `admin@capbase.fyi`
  default, so `ADMIN_EMAIL=` is required. `deploy-restore` prints the user table
  it just installed to make this impossible to miss.
- **No seeding is needed.** `SeedHistory` came across in the dump, so
  `make deploy-seed` would skip every phase anyway.
- `DATA_ONLY=1 make db-dump` produces a rows-only dump (no schema, no migration
  history) for loading into a database whose schema is already migrated.

Restoring into the local database instead — handy for rolling back an experiment:

```bash
make db-restore FILE=backups/capbase-20260802-225820.dump
```

`backups/` is gitignored; move dumps over `scp` rather than committing them.

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
| `Company` | ~35,000 |
| `FundingRound` | ~134,000 (of which ~124,000 are `kind: 'Grant'`) |
| `Investor` | ~7,400 |
| `InvestorHolding` | ~1,150 plus whatever `SEC_S1` resolved |
| `Fund` | ~95,000 across ~5,500 managers |

```sql
-- Must be zero: SBIR contributes grants, never raised capital.
SELECT count(*) FROM "FundingRound" WHERE "externalSource" = 'SBIR' AND kind <> 'Grant';
SELECT coalesce(sum("totalRaisedUsd"), 0) FROM "Company" WHERE "externalSource" = 'SBIR';

-- Must be zero: a Reg CF raise cannot exceed the statutory ceiling.
SELECT count(*) FROM "FundingRound"
WHERE "externalSource" = 'SEC_FORM_C' AND "amountUsd" > 5250000;

-- Must be zero: an S-1 edge only ever attaches to a firm we already knew.
SELECT count(*) FROM "InvestorHolding"
WHERE "externalSource" = 'SEC_S1' AND "investorId" IS NULL;

-- Must be zero: "Indefinite" offerings record no target, never a $0 one.
SELECT count(*) FROM "Fund" WHERE "targetUsd" = 0;

-- How many funds carry a vintage — i.e. how many matched a pooled Form D.
SELECT count(*) FILTER (WHERE "vintageYear" IS NOT NULL), count(*) FROM "Fund";
```

## Gotchas

- **SEC rate limit** — 10 req/s per IP across every `sec.gov` host, and a
  descriptive `SEC_USER_AGENT` with a contact email is mandatory. Both clients
  throttle to ~6 req/s; do not run two backfills against SEC at once.
- **The ADV files are latin-1**, not UTF-8. Decoding them as UTF-8 mangles firm
  names.
- **`make db-reset` is destructive** and re-runs every seed phase. It does not
  re-ingest — follow it with `make ingest-all`.
- **A Form D ten-year walk is long.** So is a 2015-onward S-1 walk (~11,000
  documents at ~800 KB each, six a second). The bulk-file sources are fast: Form C
  is 41 requests totalling 13 MB, and SBIR is one 91 MB stream. For SBIR the long
  pole is the 124,000 round upserts, not the download.
- **The SBIR file is never buffered.** It is ~91 MB, 55 of its records span more
  than one physical line (so a line split is wrong), and `JOBS_MEM_LIMIT` defaults
  to `1536m`. `util/csv.ts`'s `createCsvParser` streams it and the source
  aggregates per firm as rows arrive; a full run completes under
  `--max-old-space-size=512`.

## Adding a source to an existing dataset

The rebuild commands above create a corpus from nothing. Adding one new source to
a corpus you already have is a different job, and `make ingest-all` is the wrong
tool for it — it would re-walk ten years of Form D daily indexes for hours to
arrive back where it started. Run just the new source, locally, then ship the
result:

```bash
INGEST_RECORD_REVISIONS=false make ingest SOURCE=SEC_FORM_C DAYS=1 LIMIT=1000000
make backfill-sectors
make backfill-identifiers
make merge-candidates
make backfill-citations
make db-dump
make deploy-restore FILE=backups/capbase-<stamp>.dump VPS=user@host CONFIRM=yes
```

This is the right call for the bulk sources in particular: SBIR alone is a 91 MB
download and 124,000 upserts, and paying for it twice buys nothing. The dump
carries `_prisma_migrations`, so any migration the new source needed arrives with
the data and the api container's `prisma migrate deploy` is a no-op on next boot.

**Two caveats before running it.** `deploy-restore` replaces *every* row in
production, including the `User` table and any contribution or moderation made on
prod since the last dump — so either accept that, or take a production backup first
(`make deploy-backup`) and reconcile. And the local database must be on the same
migration as the deployed code, which it will be if the migration was applied
locally before the ingest ran.
