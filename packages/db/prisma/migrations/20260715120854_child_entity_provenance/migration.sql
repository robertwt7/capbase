-- AlterTable
ALTER TABLE "AcquisitionDeal" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT;

-- AlterTable
ALTER TABLE "ExitEvent" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT;

-- AlterTable
ALTER TABLE "InvestorHolding" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionDeal_externalSource_externalId_key" ON "AcquisitionDeal"("externalSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ExitEvent_externalSource_externalId_key" ON "ExitEvent"("externalSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestorHolding_externalSource_externalId_key" ON "InvestorHolding"("externalSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_externalSource_externalId_key" ON "Person"("externalSource", "externalId");
