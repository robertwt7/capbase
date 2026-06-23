-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT;

-- AlterTable
ALTER TABLE "FundingRound" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Company_externalSource_externalId_key" ON "Company"("externalSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "FundingRound_externalSource_externalId_key" ON "FundingRound"("externalSource", "externalId");
