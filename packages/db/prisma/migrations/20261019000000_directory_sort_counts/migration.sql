-- Stored sort keys for the /people and /investors directories. Sorting on a
-- Prisma relation count GROUP BYs the whole child table on every page view
-- (12.6 s at 578k roles). Filled by `make backfill-directory-counts`, kept
-- current by refreshDirectoryCounts (@repo/db). ADD COLUMN … DEFAULT 0 is
-- metadata-only; no CONCURRENTLY, same reasoning as add_query_indexes.

-- AlterTable
ALTER TABLE "Investor" ADD COLUMN     "holdingCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "companyCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "roleCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Investor_holdingCount_name_idx" ON "Investor"("holdingCount" DESC, "name");

-- CreateIndex
CREATE INDEX "Person_roleCount_name_idx" ON "Person"("roleCount" DESC, "name");

-- CreateIndex
CREATE INDEX "Person_companyCount_idx" ON "Person"("companyCount");
