-- DropTable
DROP TABLE "MarketSnapshot";

-- DropTable
DROP TABLE "MarketStat";

-- CreateIndex
CREATE INDEX "Company_moderationStatus_primarySector_idx" ON "Company"("moderationStatus", "primarySector");

-- CreateIndex
CREATE INDEX "Company_moderationStatus_stage_idx" ON "Company"("moderationStatus", "stage");

-- CreateIndex
CREATE INDEX "Company_moderationStatus_status_idx" ON "Company"("moderationStatus", "status");

-- CreateIndex
CREATE INDEX "Company_moderationStatus_name_idx" ON "Company"("moderationStatus", "name");

-- CreateIndex
CREATE INDEX "Company_moderationStatus_totalRaisedUsd_idx" ON "Company"("moderationStatus", "totalRaisedUsd");

