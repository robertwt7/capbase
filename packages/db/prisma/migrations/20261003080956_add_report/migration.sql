-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolutionUrl" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_entityType_entityId_idx" ON "Report"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
