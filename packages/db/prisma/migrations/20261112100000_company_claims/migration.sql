-- AlterTable
ALTER TABLE "AcquisitionDeal" ADD COLUMN     "claimId" TEXT;

-- AlterTable
ALTER TABLE "ChangeProposal" ADD COLUMN     "claimId" TEXT;

-- AlterTable
ALTER TABLE "DiversitySignal" ADD COLUMN     "claimId" TEXT;

-- AlterTable
ALTER TABLE "ExitEvent" ADD COLUMN     "claimId" TEXT;

-- AlterTable
ALTER TABLE "FundingRound" ADD COLUMN     "claimId" TEXT;

-- AlterTable
ALTER TABLE "InvestorHolding" ADD COLUMN     "claimId" TEXT;

-- AlterTable
ALTER TABLE "PersonRole" ADD COLUMN     "claimId" TEXT;

-- AlterTable
ALTER TABLE "Revision" ADD COLUMN     "claimId" TEXT;

-- CreateTable
CREATE TABLE "CompanyClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "email" TEXT,
    "domain" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "evidenceUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "endReason" TEXT,
    "lastConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyClaimToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyClaimToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyClaim_companyId_idx" ON "CompanyClaim"("companyId");

-- CreateIndex
CREATE INDEX "CompanyClaim_userId_idx" ON "CompanyClaim"("userId");

-- CreateIndex
CREATE INDEX "CompanyClaim_method_verifiedAt_revokedAt_createdAt_idx" ON "CompanyClaim"("method", "verifiedAt", "revokedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyClaimToken_tokenHash_key" ON "CompanyClaimToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CompanyClaimToken_userId_createdAt_idx" ON "CompanyClaimToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyClaimToken_companyId_createdAt_idx" ON "CompanyClaimToken"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AcquisitionDeal_claimId_idx" ON "AcquisitionDeal"("claimId");

-- CreateIndex
CREATE INDEX "ChangeProposal_claimId_idx" ON "ChangeProposal"("claimId");

-- CreateIndex
CREATE INDEX "DiversitySignal_claimId_idx" ON "DiversitySignal"("claimId");

-- CreateIndex
CREATE INDEX "ExitEvent_claimId_idx" ON "ExitEvent"("claimId");

-- CreateIndex
CREATE INDEX "FundingRound_claimId_idx" ON "FundingRound"("claimId");

-- CreateIndex
CREATE INDEX "InvestorHolding_claimId_idx" ON "InvestorHolding"("claimId");

-- CreateIndex
CREATE INDEX "PersonRole_claimId_idx" ON "PersonRole"("claimId");

-- AddForeignKey
ALTER TABLE "CompanyClaim" ADD CONSTRAINT "CompanyClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaim" ADD CONSTRAINT "CompanyClaim_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaimToken" ADD CONSTRAINT "CompanyClaimToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaimToken" ADD CONSTRAINT "CompanyClaimToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
