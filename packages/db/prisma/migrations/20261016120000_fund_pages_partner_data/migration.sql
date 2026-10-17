-- Fund pages and licensed partner data: fund slug, status, lifecycle dates and
-- terms, and the directory size key; LP commitments; point-in-time fund
-- metrics; and the PRIVATE PersonContact table (never read by a public path).
-- Additive only, plus one backfill of the new size key.
--
-- Hand-edited: the sizeUsd index is `DESC NULLS LAST` (Prisma cannot declare
-- null ordering), matching the read's `nulls: 'last'`.

-- AlterTable
ALTER TABLE "Fund" ADD COLUMN     "carriedInterestPct" DOUBLE PRECISION,
ADD COLUMN     "finalCloseDate" TIMESTAMP(3),
ADD COLUMN     "hardCapUsd" BIGINT,
ADD COLUMN     "hurdleRatePct" DOUBLE PRECISION,
ADD COLUMN     "latestCloseDate" TIMESTAMP(3),
ADD COLUMN     "launchDate" TIMESTAMP(3),
ADD COLUMN     "managementFeePct" DOUBLE PRECISION,
ADD COLUMN     "regionFocus" TEXT,
ADD COLUMN     "sizeUsd" BIGINT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "status" TEXT,
ADD COLUMN     "targetIrrGrossMaxPct" DOUBLE PRECISION,
ADD COLUMN     "targetIrrGrossMinPct" DOUBLE PRECISION,
ADD COLUMN     "targetIrrNetMaxPct" DOUBLE PRECISION,
ADD COLUMN     "targetIrrNetMinPct" DOUBLE PRECISION;

-- Backfill the size key: the figure the directory row already shows.
UPDATE "Fund" SET "sizeUsd" = COALESCE("grossAssetsUsd", "closedUsd");

-- CreateTable
CREATE TABLE "FundCommitment" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "amountUsd" BIGINT,
    "amountLocal" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "externalSource" TEXT,
    "externalId" TEXT,
    "moderationStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundMetric" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "asAt" TIMESTAMP(3) NOT NULL,
    "dryPowderUsd" BIGINT,
    "aumUsd" BIGINT,
    "unrealizedUsd" BIGINT,
    "externalSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonContact" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "roleId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "externalSource" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundCommitment_fundId_idx" ON "FundCommitment"("fundId");

-- CreateIndex
CREATE INDEX "FundCommitment_investorId_idx" ON "FundCommitment"("investorId");

-- CreateIndex
CREATE UNIQUE INDEX "FundCommitment_externalSource_externalId_key" ON "FundCommitment"("externalSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "FundMetric_fundId_asAt_key" ON "FundMetric"("fundId", "asAt");

-- CreateIndex
CREATE UNIQUE INDEX "PersonContact_roleId_key" ON "PersonContact"("roleId");

-- CreateIndex
CREATE INDEX "PersonContact_personId_idx" ON "PersonContact"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonContact_externalSource_externalId_key" ON "PersonContact"("externalSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Fund_slug_key" ON "Fund"("slug");

-- CreateIndex
CREATE INDEX "Fund_moderationStatus_sizeUsd_name_idx" ON "Fund"("moderationStatus", "sizeUsd" DESC NULLS LAST, "name");

-- CreateIndex
CREATE INDEX "Fund_moderationStatus_status_idx" ON "Fund"("moderationStatus", "status");

-- AddForeignKey
ALTER TABLE "FundCommitment" ADD CONSTRAINT "FundCommitment_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundCommitment" ADD CONSTRAINT "FundCommitment_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundMetric" ADD CONSTRAINT "FundMetric_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonContact" ADD CONSTRAINT "PersonContact_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonContact" ADD CONSTRAINT "PersonContact_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "PersonRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

