-- The /investors card sample: up to six visible holdings per firm in one
-- LATERAL … LIMIT query (Prisma's nested `take` is not a per-parent LIMIT and
-- loaded every holding of the page's firms). Ordered by (externalSource, id),
-- the sample stops after six rows per firm: an ordered scan signed in, three
-- ranges that skip the partner rows (560k of 562k) signed out. The leading
-- investorId covers every lookup the dropped index served. No CONCURRENTLY,
-- same reasoning as add_query_indexes (seconds on 562k rows; reads not blocked).

-- DropIndex
DROP INDEX "InvestorHolding_investorId_idx";

-- CreateIndex
CREATE INDEX "InvestorHolding_investorId_externalSource_id_idx" ON "InvestorHolding"("investorId", "externalSource", "id");
