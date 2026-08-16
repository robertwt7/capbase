# Identifier crosswalk + admin merge queue

We have three ingestion sources writing into the same Company and Investor tables
(SEC_EDGAR, WIKIDATA, SEC_ADV) and the only admin actions are approve and reject.
There is no way to say "these two rows are the same firm" and no way to undo it when
the match-and-enrich heuristic gets it wrong. Duplicates are accumulating and every
new source makes it worse — this gets strictly more expensive the longer we leave it.

Two halves:

**Identifiers.** `Investor` carries `crdNumber`/`cikNumber` but `Company` carries no
external identifier at all — no CIK, no LEI, no Wikidata QID, no ticker. That means our
data can't be joined to anything else, which is most of the point of being open. We want
an `EntityIdentifier` table, unique on `(scheme, value)`, pointing at either a company or
an investor, holding LEI / CIK / CRD / Wikidata QID / OpenCorporates ID / ticker / domain.
GLEIF publishes the whole LEI index under CC0 and there's a bi-weekly CSV mapping
OpenCorporates IDs to LEIs, so this can be seeded rather than hand-entered. Once
identifiers exist they also become a much better match key than normalized name.

**Merge.** An admin queue that surfaces candidate duplicate pairs — shared identifier
first, then domain, then normalized name — shows them side by side, and merges with a
redirect from the losing slug so existing external links and our own sitemap don't break.
Merging needs to move child rows (rounds, people, holdings, acquisitions, exits) onto the
surviving row and reconcile the `(externalSource, externalId)` unique keys.

Worth doing before we add the new ingestion sources, since those will create exactly the
duplicates this is meant to catch.
