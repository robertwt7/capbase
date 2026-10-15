-- CreateTable
CREATE TABLE "InvestorChangeProposal" (
    "id" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "previous" JSONB,
    "note" TEXT,
    "sourceUrl" TEXT,
    "moderationStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestorChangeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvestorChangeProposal_investorId_idx" ON "InvestorChangeProposal"("investorId");

-- CreateIndex
CREATE INDEX "InvestorChangeProposal_moderationStatus_createdAt_id_idx" ON "InvestorChangeProposal"("moderationStatus", "createdAt", "id");

-- CreateIndex
CREATE INDEX "InvestorChangeProposal_submittedById_moderationStatus_creat_idx" ON "InvestorChangeProposal"("submittedById", "moderationStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "InvestorChangeProposal" ADD CONSTRAINT "InvestorChangeProposal_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorChangeProposal" ADD CONSTRAINT "InvestorChangeProposal_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
