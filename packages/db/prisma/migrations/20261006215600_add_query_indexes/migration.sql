-- Indexes for hot read paths that sequentially scanned large tables: the
-- contribution gate and pending cap (submittedById + status, newest first), the
-- admin queue (status, newest first, cursor on createdAt/id), company-profile
-- citations (looked up by entityId alone) and the /funds and valuation sorts.
-- The single-column moderationStatus indexes are replaced, not kept: every new
-- [moderationStatus, ...] composite also serves a bare status filter.
--
-- Hand-edited: the three DESC columns below are `DESC NULLS LAST`. The reads
-- sort nulls last, which a default btree read backwards (DESC NULLS FIRST)
-- can't serve. Prisma can't declare null ordering in @@index, but it ignores it
-- when diffing, so schema.prisma declares `(sort: Desc)` and there is no drift.
--
-- No CONCURRENTLY: it can't run inside a multi-statement migration's
-- transaction, and the builds take seconds. A plain CREATE INDEX blocks writes,
-- not reads, for that window.

-- DropIndex
DROP INDEX "AcquisitionDeal_moderationStatus_idx";

-- DropIndex
DROP INDEX "ChangeProposal_moderationStatus_idx";

-- DropIndex
DROP INDEX "Citation_entityType_entityId_idx";

-- DropIndex
DROP INDEX "Company_moderationStatus_idx";

-- DropIndex
DROP INDEX "DiversitySignal_moderationStatus_idx";

-- DropIndex
DROP INDEX "ExitEvent_moderationStatus_idx";

-- DropIndex
DROP INDEX "Fund_moderationStatus_grossAssetsUsd_idx";

-- DropIndex
DROP INDEX "Fund_moderationStatus_vintageYear_idx";

-- DropIndex
DROP INDEX "FundingRound_moderationStatus_idx";

-- DropIndex
DROP INDEX "InvestorHolding_moderationStatus_idx";

-- DropIndex
DROP INDEX "PersonRole_moderationStatus_idx";

-- CreateIndex
CREATE INDEX "AcquisitionDeal_moderationStatus_createdAt_id_idx" ON "AcquisitionDeal"("moderationStatus", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AcquisitionDeal_submittedById_moderationStatus_createdAt_idx" ON "AcquisitionDeal"("submittedById", "moderationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ChangeProposal_moderationStatus_createdAt_id_idx" ON "ChangeProposal"("moderationStatus", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ChangeProposal_submittedById_moderationStatus_createdAt_idx" ON "ChangeProposal"("submittedById", "moderationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Citation_entityId_entityType_idx" ON "Citation"("entityId", "entityType");

-- CreateIndex
CREATE INDEX "Company_moderationStatus_createdAt_id_idx" ON "Company"("moderationStatus", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Company_submittedById_moderationStatus_createdAt_idx" ON "Company"("submittedById", "moderationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Company_moderationStatus_lastValuationUsd_idx" ON "Company"("moderationStatus", "lastValuationUsd" DESC NULLS LAST);

-- CreateIndex
CREATE INDEX "DiversitySignal_moderationStatus_createdAt_id_idx" ON "DiversitySignal"("moderationStatus", "createdAt", "id");

-- CreateIndex
CREATE INDEX "DiversitySignal_submittedById_moderationStatus_createdAt_idx" ON "DiversitySignal"("submittedById", "moderationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ExitEvent_moderationStatus_createdAt_id_idx" ON "ExitEvent"("moderationStatus", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ExitEvent_submittedById_moderationStatus_createdAt_idx" ON "ExitEvent"("submittedById", "moderationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Fund_moderationStatus_vintageYear_name_idx" ON "Fund"("moderationStatus", "vintageYear" DESC NULLS LAST, "name");

-- CreateIndex
CREATE INDEX "Fund_moderationStatus_grossAssetsUsd_name_idx" ON "Fund"("moderationStatus", "grossAssetsUsd" DESC NULLS LAST, "name");

-- CreateIndex
CREATE INDEX "FundingRound_moderationStatus_createdAt_id_idx" ON "FundingRound"("moderationStatus", "createdAt", "id");

-- CreateIndex
CREATE INDEX "FundingRound_submittedById_moderationStatus_createdAt_idx" ON "FundingRound"("submittedById", "moderationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "InvestorHolding_moderationStatus_createdAt_id_idx" ON "InvestorHolding"("moderationStatus", "createdAt", "id");

-- CreateIndex
CREATE INDEX "InvestorHolding_submittedById_moderationStatus_createdAt_idx" ON "InvestorHolding"("submittedById", "moderationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "PersonRole_moderationStatus_createdAt_id_idx" ON "PersonRole"("moderationStatus", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PersonRole_submittedById_moderationStatus_createdAt_idx" ON "PersonRole"("submittedById", "moderationStatus", "createdAt");
