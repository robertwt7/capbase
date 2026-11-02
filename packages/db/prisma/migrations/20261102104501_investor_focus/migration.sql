-- CreateTable
CREATE TABLE "InvestorFocus" (
    "id" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "stages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mainStrategy" TEXT,
    "strategies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "industries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verticals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "geographies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rangeMinUsd" BIGINT,
    "rangeMaxUsd" BIGINT,
    "rangeCurrency" TEXT NOT NULL DEFAULT 'USD',
    "rangeMinLocal" BIGINT,
    "rangeMaxLocal" BIGINT,
    "reportedOn" TIMESTAMP(3) NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "externalSource" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestorFocus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvestorFocus_investorId_idx" ON "InvestorFocus"("investorId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestorFocus_externalSource_externalId_key" ON "InvestorFocus"("externalSource", "externalId");

-- AddForeignKey
ALTER TABLE "InvestorFocus" ADD CONSTRAINT "InvestorFocus_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
