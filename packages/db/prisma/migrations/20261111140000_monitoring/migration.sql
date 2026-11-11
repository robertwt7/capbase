-- AlterTable
ALTER TABLE "SavedCompany" ADD COLUMN     "evaluatedAt" TIMESTAMP(3),
ADD COLUMN     "monitorStatus" TEXT,
ADD COLUMN     "monitoredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SavedSearch" ADD COLUMN     "evaluatedAt" TIMESTAMP(3),
ADD COLUMN     "monitorStatus" TEXT,
ADD COLUMN     "monitoredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MonitorSeenCompany" (
    "searchId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "MonitorSeenCompany_pkey" PRIMARY KEY ("searchId","companyId")
);

-- CreateTable
CREATE TABLE "MonitorSeenRound" (
    "userId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,

    CONSTRAINT "MonitorSeenRound_pkey" PRIMARY KEY ("userId","roundId")
);

-- CreateTable
CREATE TABLE "MonitorEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "searchId" TEXT,
    "roundId" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitorEvent_userId_observedAt_id_idx" ON "MonitorEvent"("userId", "observedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorEvent_searchId_companyId_key" ON "MonitorEvent"("searchId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorEvent_userId_roundId_key" ON "MonitorEvent"("userId", "roundId");

-- AddForeignKey
ALTER TABLE "MonitorSeenCompany" ADD CONSTRAINT "MonitorSeenCompany_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "SavedSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorSeenCompany" ADD CONSTRAINT "MonitorSeenCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorSeenRound" ADD CONSTRAINT "MonitorSeenRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorSeenRound" ADD CONSTRAINT "MonitorSeenRound_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "FundingRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorEvent" ADD CONSTRAINT "MonitorEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorEvent" ADD CONSTRAINT "MonitorEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorEvent" ADD CONSTRAINT "MonitorEvent_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "SavedSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorEvent" ADD CONSTRAINT "MonitorEvent_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "FundingRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

