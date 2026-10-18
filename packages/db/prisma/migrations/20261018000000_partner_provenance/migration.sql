-- Partner provenance: which rows exist only because of the licensed partner,
-- and which column values the partner wrote into other sources' rows. Additive;
-- every existing row starts unmarked, and `make backfill-partner-provenance`
-- reconstructs the marks for data loaded before this migration.
ALTER TABLE "Company" ADD COLUMN "partnerFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
                      ADD COLUMN "partnerOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Investor" ADD COLUMN "partnerFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
                       ADD COLUMN "partnerOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Fund" ADD COLUMN "partnerFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
                   ADD COLUMN "partnerOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FundingRound" ADD COLUMN "partnerFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "RoundInvestor" ADD COLUMN "externalSource" TEXT;

CREATE INDEX "Company_partnerOnly_idx" ON "Company"("partnerOnly");
CREATE INDEX "Investor_partnerOnly_idx" ON "Investor"("partnerOnly");
CREATE INDEX "Fund_partnerOnly_idx" ON "Fund"("partnerOnly");
