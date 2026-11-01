-- Company ingestion routing and match repair. Additive only: no data is
-- touched, and no existing crosswalk entry is certified by this migration.

-- CreateTable
CREATE TABLE "CompanyIngestBinding" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceCompanyId" TEXT NOT NULL,
    "companyId" TEXT,
    "status" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyIngestBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestRoundBinding" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRoundId" TEXT NOT NULL,
    "sourceCompanyId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestRoundBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyRepairRun" (
    "id" TEXT NOT NULL,
    "databaseFingerprint" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "toolVersion" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "label" TEXT,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CompanyRepairRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyRepairGroup" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "groupHash" TEXT NOT NULL,
    "companyIds" TEXT[],
    "sourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "operations" JSONB NOT NULL,
    "inverse" JSONB NOT NULL,
    "beforeHash" TEXT NOT NULL,
    "afterHash" TEXT NOT NULL,
    "createdIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledBackAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyRepairGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyIngestBinding_companyId_idx" ON "CompanyIngestBinding"("companyId");

-- CreateIndex
CREATE INDEX "CompanyIngestBinding_status_idx" ON "CompanyIngestBinding"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyIngestBinding_source_sourceCompanyId_key" ON "CompanyIngestBinding"("source", "sourceCompanyId");

-- CreateIndex
CREATE INDEX "IngestRoundBinding_roundId_idx" ON "IngestRoundBinding"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestRoundBinding_source_sourceRoundId_key" ON "IngestRoundBinding"("source", "sourceRoundId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyRepairRun_databaseFingerprint_manifestHash_key" ON "CompanyRepairRun"("databaseFingerprint", "manifestHash");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyRepairGroup_runId_groupKey_key" ON "CompanyRepairGroup"("runId", "groupKey");

-- AddForeignKey
ALTER TABLE "CompanyRepairGroup" ADD CONSTRAINT "CompanyRepairGroup_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CompanyRepairRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
