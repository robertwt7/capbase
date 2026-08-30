-- CreateTable
CREATE TABLE "Fund" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "strategy" TEXT,
    "vintageYear" INTEGER,
    "targetUsd" BIGINT,
    "closedUsd" BIGINT,
    "grossAssetsUsd" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "hq" TEXT,
    "secFundId" TEXT,
    "cikNumber" TEXT,
    "externalSource" TEXT,
    "externalId" TEXT,
    "moderationStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fund_managerId_idx" ON "Fund"("managerId");

-- CreateIndex
CREATE INDEX "Fund_moderationStatus_idx" ON "Fund"("moderationStatus");

-- CreateIndex
CREATE INDEX "Fund_moderationStatus_strategy_idx" ON "Fund"("moderationStatus", "strategy");

-- CreateIndex
CREATE INDEX "Fund_moderationStatus_vintageYear_idx" ON "Fund"("moderationStatus", "vintageYear");

-- CreateIndex
CREATE INDEX "Fund_moderationStatus_grossAssetsUsd_idx" ON "Fund"("moderationStatus", "grossAssetsUsd");

-- CreateIndex
CREATE INDEX "Fund_moderationStatus_name_idx" ON "Fund"("moderationStatus", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Fund_externalSource_externalId_key" ON "Fund"("externalSource", "externalId");

-- AddForeignKey
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
