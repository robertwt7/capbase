# Field-level citations + public revision history

We call ourselves the open alternative to Crunchbase but a visitor looking at a company
profile has no way to tell an SEC-derived figure from a stranger's guess. Every number on
the page is presented with the same authority and none of them show where they came from.
Crunchbase can't do this — their data is licensed and aggregated — so it's one of the few
places we can be straightforwardly better rather than cheaper.

Two connected things:

**Citations.** Every fact should be traceable to a primary document. We already store
`externalSource`/`externalId` on most rows, and the source URLs are derivable from what's
there — SEC filings from CIK + accession, Wikidata from the QID, ADV from the CRD — so the
existing ~11k companies and ~5k rounds can be backfilled without re-fetching anything.
Contributors should be able to attach a source URL too, and facts with no citation should
visibly say so rather than looking identical to sourced ones.

**Revision history.** A crowdsourced database without a visible audit trail is asking for
trust it hasn't earned. We want a public per-company timeline: what changed, from what to
what, who did it, and when. Note that `applyProposal` currently overwrites the company row
without keeping the old values, so history can't be reconstructed retroactively — whatever
we build starts empty from the day it ships, which is an argument for shipping the capture
side early even if the page comes later.

The ingest worker's enrichment path also mutates companies with no record at all. That
should show up in the timeline as well, attributed to the source that caused it.
