-- Company screening: the financing-window criterion (`roundWithin`, `roundFrom`/`roundTo`)
-- is a date range on FundingRound inside an EXISTS. Without an index on "date" a
-- financing-only directory query seq-scans every round. Measured on the local dataset
-- (548k rounds), it serves the window with or without a kind/size criterion; an index
-- led by (moderationStatus, kind) was not usable for a window without a kind.
-- Rollback: DROP INDEX "FundingRound_date_idx";
CREATE INDEX "FundingRound_date_idx" ON "FundingRound"("date");
