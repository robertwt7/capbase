-- AlterTable
ALTER TABLE "User" ADD COLUMN     "digestOptInAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MonitorDigest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "providerId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "MonitorDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitorDigest_status_nextAttemptAt_idx" ON "MonitorDigest"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorDigest_userId_weekStart_key" ON "MonitorDigest"("userId", "weekStart");

-- AddForeignKey
ALTER TABLE "MonitorDigest" ADD CONSTRAINT "MonitorDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

