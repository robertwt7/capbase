-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "oneLiner" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hq" TEXT NOT NULL,
    "founded" INTEGER NOT NULL,
    "headcount" INTEGER NOT NULL,
    "industry" TEXT[],
    "status" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "totalRaisedUsd" BIGINT NOT NULL,
    "lastValuationUsd" BIGINT,
    "revenueUsd" BIGINT,
    "revenueGrowthPct" DOUBLE PRECISION,
    "grossMarginPct" DOUBLE PRECISION,
    "burnMonths" INTEGER,
    "moderationStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingRound" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amountUsd" BIGINT NOT NULL,
    "postMoneyUsd" BIGINT,
    "lead" TEXT,
    "moderationStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundInvestor" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lead" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RoundInvestor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestorHolding" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "firstRound" TEXT NOT NULL,
    "rounds" INTEGER NOT NULL,
    "moderationStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestorHolding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "since" INTEGER NOT NULL,
    "prior" TEXT,
    "moderationStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionDeal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amountUsd" BIGINT,
    "rationale" TEXT NOT NULL,
    "moderationStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcquisitionDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "valueUsd" BIGINT,
    "detail" TEXT NOT NULL,
    "moderationStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiversitySignal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "moderationStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiversitySignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketStat" (
    "id" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "dealCount" INTEGER NOT NULL,
    "totalRaisedUsd" BIGINT NOT NULL,
    "medianValuationUsd" BIGINT NOT NULL,
    "trendPct" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MarketStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "totalRaisedUsd" BIGINT NOT NULL,
    "dealCount" INTEGER NOT NULL,
    "newUnicorns" INTEGER NOT NULL,
    "quarter" TEXT NOT NULL,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE INDEX "Company_moderationStatus_idx" ON "Company"("moderationStatus");

-- CreateIndex
CREATE INDEX "FundingRound_companyId_idx" ON "FundingRound"("companyId");

-- CreateIndex
CREATE INDEX "FundingRound_moderationStatus_idx" ON "FundingRound"("moderationStatus");

-- CreateIndex
CREATE INDEX "RoundInvestor_roundId_idx" ON "RoundInvestor"("roundId");

-- CreateIndex
CREATE INDEX "InvestorHolding_companyId_idx" ON "InvestorHolding"("companyId");

-- CreateIndex
CREATE INDEX "InvestorHolding_moderationStatus_idx" ON "InvestorHolding"("moderationStatus");

-- CreateIndex
CREATE INDEX "Person_companyId_idx" ON "Person"("companyId");

-- CreateIndex
CREATE INDEX "Person_moderationStatus_idx" ON "Person"("moderationStatus");

-- CreateIndex
CREATE INDEX "AcquisitionDeal_companyId_idx" ON "AcquisitionDeal"("companyId");

-- CreateIndex
CREATE INDEX "AcquisitionDeal_moderationStatus_idx" ON "AcquisitionDeal"("moderationStatus");

-- CreateIndex
CREATE INDEX "ExitEvent_companyId_idx" ON "ExitEvent"("companyId");

-- CreateIndex
CREATE INDEX "ExitEvent_moderationStatus_idx" ON "ExitEvent"("moderationStatus");

-- CreateIndex
CREATE INDEX "DiversitySignal_companyId_idx" ON "DiversitySignal"("companyId");

-- CreateIndex
CREATE INDEX "DiversitySignal_moderationStatus_idx" ON "DiversitySignal"("moderationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "MarketStat_sector_key" ON "MarketStat"("sector");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingRound" ADD CONSTRAINT "FundingRound_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingRound" ADD CONSTRAINT "FundingRound_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundInvestor" ADD CONSTRAINT "RoundInvestor_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "FundingRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorHolding" ADD CONSTRAINT "InvestorHolding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorHolding" ADD CONSTRAINT "InvestorHolding_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionDeal" ADD CONSTRAINT "AcquisitionDeal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionDeal" ADD CONSTRAINT "AcquisitionDeal_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitEvent" ADD CONSTRAINT "ExitEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitEvent" ADD CONSTRAINT "ExitEvent_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiversitySignal" ADD CONSTRAINT "DiversitySignal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiversitySignal" ADD CONSTRAINT "DiversitySignal_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
