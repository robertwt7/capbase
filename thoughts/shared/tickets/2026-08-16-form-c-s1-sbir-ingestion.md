# New ingestion sources: Form C, S-1, SBIR

CLAUDE.md says no free source discloses investor→company edges. That's true of Form D and
Form ADV but it isn't true in general, and we're leaving a lot on the table.

**SEC Form C (Reg CF)** — the DERA crowdfunding data sets are tab-delimited bulk files
covering roughly 8,500 offerings from about 7,000 issuers since 2016, with around $1.3bn in
reported proceeds across ~4,000 of them. This is real seed-stage funding with *actual amounts
raised*, not just the offering size Form D gives us. Cleanest new source to add and it maps
straight onto the existing `NormalizedRecord.round` shape.

**SEC Form S-1** — the principal-stockholders table in every IPO registration names each
holder above 5%. That is the investor→portfolio-company edge set, disclosed by law, for
every company that ever went public. This is the hard one: the tables are HTML of varying
quality across decades of filings, so it needs a real parser and probably a confidence score
per extracted row. But it's the thing that would make investor profiles worth visiting —
right now most of them are empty by design.

**SBIR.gov** — public API of US non-dilutive awards with company name, amount, and address.
Deep-tech funding that never shows up in a Form D. Also gives us a lot of small companies
that no other source covers.

All three should implement the existing `IngestionSource` interface in `apps/jobs/src/sources/`
and go through the same auto-APPROVE + match-and-enrich path. Form C and SBIR are both bulk
snapshots rather than daily feeds, so they'll behave like SEC_ADV — ignore `days`, stay off
the daily cron, run from `make ingest SOURCE=...`.

Note these will generate duplicates against existing rows, so the merge queue ticket should
probably land first.
