# Funds as a first-class entity

`Investor` has `fundCount` and `assetsUsd` as flat scalars — we know Andreessen Horowitz
reports 106 VC funds and $106.5B gross assets, but we can't name a single one of those funds,
say when it was raised, or how big it was. Fund vintages and sizes are the spine of what
PitchBook sells, and as far as we can tell there's no free fund-vintage database anywhere.

Want a `Fund` table: manager (FK to `Investor`), name, vintage year, target size, closed
size, strategy, currency. Two sources feed it and we already touch both:

**Form ADV Schedule D section 7.B.(1)** itemises each private fund a filer reports, with its
type and gross asset value. The investor-entity plan noted the main ADV file only carries the
firm-level rollup — the per-fund detail is in the Schedule D tables, which is a separate part
of the same bulk download. Needs a spike to confirm the exact file and columns before
committing.

**Pooled-fund Form D filings.** `INGEST_SKIP_FUNDS` currently throws these away. Keeping them
out of the *company* table is right — they aren't operating companies — but they are literally
fund closes: manager, fund name, amount raised, date. Routing them to a `Fund` table instead
of dropping them is nearly free, because the filings are already flowing through the daily
cron.

Fund *performance* (IRR/TVPI/DPI) is the obvious next thing and it's what would really
differentiate us, but it's a separate problem. US public pension systems do publish net IRR
and multiples per fund in their public reporting, so it may be obtainable — needs a spike to
check whether the formats are machine-readable, since disclosure quality varies a lot by
system. Don't scope it into this ticket until that's answered.

Surface: fund list on the investor profile, and probably a `/funds` directory once there's
enough in there to be worth browsing.
