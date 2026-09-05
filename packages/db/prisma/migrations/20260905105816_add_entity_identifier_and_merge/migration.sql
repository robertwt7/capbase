-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "mergedIntoId" TEXT;

-- AlterTable
ALTER TABLE "Investor" ADD COLUMN     "mergedIntoId" TEXT;

-- CreateTable
CREATE TABLE "EntityIdentifier" (
    "id" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MergeCandidate" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "leftId" TEXT NOT NULL,
    "rightId" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MergeCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MergeRecord" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "survivorId" TEXT NOT NULL,
    "losingId" TEXT NOT NULL,
    "moved" JSONB NOT NULL,
    "candidateId" TEXT,
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mergedById" TEXT,
    "unmergedAt" TIMESTAMP(3),
    "unmergedById" TEXT,

    CONSTRAINT "MergeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityIdentifier_entityType_entityId_idx" ON "EntityIdentifier"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityIdentifier_scheme_value_entityType_key" ON "EntityIdentifier"("scheme", "value", "entityType");

-- CreateIndex
CREATE INDEX "MergeCandidate_status_entityType_idx" ON "MergeCandidate"("status", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "MergeCandidate_entityType_leftId_rightId_key" ON "MergeCandidate"("entityType", "leftId", "rightId");

-- CreateIndex
CREATE INDEX "MergeRecord_entityType_survivorId_idx" ON "MergeRecord"("entityType", "survivorId");

-- CreateIndex
CREATE INDEX "MergeRecord_losingId_idx" ON "MergeRecord"("losingId");

-- CreateIndex
CREATE INDEX "Company_mergedIntoId_idx" ON "Company"("mergedIntoId");

-- CreateIndex
CREATE INDEX "Investor_mergedIntoId_idx" ON "Investor"("mergedIntoId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investor" ADD CONSTRAINT "Investor_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Investor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeCandidate" ADD CONSTRAINT "MergeCandidate_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeRecord" ADD CONSTRAINT "MergeRecord_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "MergeCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeRecord" ADD CONSTRAINT "MergeRecord_mergedById_fkey" FOREIGN KEY ("mergedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
