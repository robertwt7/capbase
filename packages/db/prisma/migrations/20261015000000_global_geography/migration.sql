-- Global geography: a filterable country on companies and investors, and the
-- native currency of a funding round. Additive only — nullable columns plus a
-- constant default, which PG 16 applies without rewriting the table — so the
-- previous release runs unchanged against this schema (rollback-safe).
--
-- No data is written here. Country is backfilled by the re-runnable
-- `backfill-geography` jobs script, never by a migration holding api boot hostage.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "countryCode" TEXT;

-- AlterTable
ALTER TABLE "FundingRound" ADD COLUMN     "amountLocal" BIGINT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD';

-- AlterTable
ALTER TABLE "Investor" ADD COLUMN     "countryCode" TEXT;

-- CreateIndex
CREATE INDEX "Company_moderationStatus_countryCode_idx" ON "Company"("moderationStatus", "countryCode");

-- CreateIndex
CREATE INDEX "Investor_moderationStatus_countryCode_idx" ON "Investor"("moderationStatus", "countryCode");
