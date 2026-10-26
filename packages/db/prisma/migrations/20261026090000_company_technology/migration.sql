-- CreateTable
CREATE TABLE "Technology" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "vendorUrl" TEXT NOT NULL,

    CONSTRAINT "Technology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyWebsiteScan" (
    "id" TEXT NOT NULL,
    "scanKey" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "targetDomain" TEXT NOT NULL,
    "detectorVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastResultDigest" TEXT,

    CONSTRAINT "CompanyWebsiteScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyTechnology" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "technologyId" TEXT NOT NULL,
    "evidenceUrl" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "detectorVersion" TEXT NOT NULL,
    "absenceCount" INTEGER NOT NULL DEFAULT 0,
    "firstAbsentAt" TIMESTAMP(3),
    "lastAbsentAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "suppressedAt" TIMESTAMP(3),
    "suppressionReason" TEXT,

    CONSTRAINT "CompanyTechnology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppResource" (
    "id" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "storeUrl" TEXT NOT NULL,

    CONSTRAINT "AppResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyApp" (
    "id" TEXT NOT NULL,
    "provenanceKey" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "evidenceUrl" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verificationReason" TEXT,
    "verificationUrl" TEXT,
    "suppressedAt" TIMESTAMP(3),
    "suppressionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentCursor" (
    "key" TEXT NOT NULL,
    "cursorId" TEXT,

    CONSTRAINT "EnrichmentCursor_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Technology_slug_key" ON "Technology"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyWebsiteScan_scanKey_key" ON "CompanyWebsiteScan"("scanKey");

-- CreateIndex
CREATE INDEX "CompanyWebsiteScan_nextAttemptAt_idx" ON "CompanyWebsiteScan"("nextAttemptAt");

-- CreateIndex
CREATE INDEX "CompanyWebsiteScan_companyId_targetUrl_createdAt_id_idx" ON "CompanyWebsiteScan"("companyId", "targetUrl", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CompanyTechnology_scanId_lastSeenAt_idx" ON "CompanyTechnology"("scanId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTechnology_scanId_technologyId_key" ON "CompanyTechnology"("scanId", "technologyId");

-- CreateIndex
CREATE UNIQUE INDEX "AppResource_store_appId_key" ON "AppResource"("store", "appId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyApp_provenanceKey_key" ON "CompanyApp"("provenanceKey");

-- CreateIndex
CREATE INDEX "CompanyApp_companyId_targetUrl_resourceId_idx" ON "CompanyApp"("companyId", "targetUrl", "resourceId");

-- AddForeignKey
ALTER TABLE "CompanyWebsiteScan" ADD CONSTRAINT "CompanyWebsiteScan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTechnology" ADD CONSTRAINT "CompanyTechnology_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "CompanyWebsiteScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTechnology" ADD CONSTRAINT "CompanyTechnology_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "Technology"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyApp" ADD CONSTRAINT "CompanyApp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyApp" ADD CONSTRAINT "CompanyApp_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "AppResource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

