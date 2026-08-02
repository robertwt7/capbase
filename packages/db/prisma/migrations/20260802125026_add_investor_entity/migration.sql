-- AlterTable
ALTER TABLE "InvestorHolding" ADD COLUMN     "investorId" TEXT;

-- AlterTable
ALTER TABLE "RoundInvestor" ADD COLUMN     "investorId" TEXT;

-- CreateTable
CREATE TABLE "Investor" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "type" TEXT NOT NULL,
    "hq" TEXT,
    "websiteUrl" TEXT,
    "linkedinUrl" TEXT,
    "domain" TEXT,
    "description" TEXT,
    "crdNumber" TEXT,
    "cikNumber" TEXT,
    "fundCount" INTEGER,
    "assetsUsd" BIGINT,
    "foundedYear" INTEGER,
    "externalSource" TEXT,
    "externalId" TEXT,
    "moderationStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Investor_slug_key" ON "Investor"("slug");

-- CreateIndex
CREATE INDEX "Investor_moderationStatus_idx" ON "Investor"("moderationStatus");

-- CreateIndex
CREATE INDEX "Investor_moderationStatus_type_idx" ON "Investor"("moderationStatus", "type");

-- CreateIndex
CREATE INDEX "Investor_moderationStatus_name_idx" ON "Investor"("moderationStatus", "name");

-- CreateIndex
CREATE INDEX "Investor_domain_idx" ON "Investor"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Investor_externalSource_externalId_key" ON "Investor"("externalSource", "externalId");

-- CreateIndex
CREATE INDEX "InvestorHolding_investorId_idx" ON "InvestorHolding"("investorId");

-- CreateIndex
CREATE INDEX "RoundInvestor_investorId_idx" ON "RoundInvestor"("investorId");

-- AddForeignKey
ALTER TABLE "RoundInvestor" ADD CONSTRAINT "RoundInvestor_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investor" ADD CONSTRAINT "Investor_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestorHolding" ADD CONSTRAINT "InvestorHolding_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data migration. Runs once, in this order:
--   1. purge the European Investment Bank holdings,
--   2. mint one Investor per remaining distinct investor name,
--   3. link the existing holdings and round positions to it.
-- Step 1 must precede step 2 so no EIB investor row is ever created.
-- ---------------------------------------------------------------------------

-- 1. The EIB is an EU development lender: its Wikidata P1951 statements are loan
--    recipients, not equity investments. These rows accounted for 5,583 of the
--    6,730 holdings (83%) and skewed every portfolio and sector figure on the
--    site. All carry WIKIDATA provenance, so no human contribution is lost.
--    Ingestion now filters this entity out by QID (see investor-class-map.ts).
DELETE FROM "InvestorHolding"
WHERE name = 'European Investment Bank'
  AND "externalSource" = 'WIKIDATA';

-- 2. One canonical Investor per distinct name across both name-bearing tables.
--    Type is the most common type recorded for that name; RoundInvestor has no
--    type column, so its rows contribute a neutral 'Venture' vote. Slugs are
--    kebab-cased with a numeric suffix on collision, mirroring the uniqueness
--    strategy IngestService uses for companies.
WITH all_names AS (
    SELECT name, type FROM "InvestorHolding"
    UNION ALL
    SELECT name, 'Venture' AS type FROM "RoundInvestor"
),
distinct_names AS (
    SELECT name, mode() WITHIN GROUP (ORDER BY type) AS type
    FROM all_names
    WHERE btrim(name) <> ''
    GROUP BY name
),
slugged AS (
    SELECT
        name,
        type,
        regexp_replace(
            regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'),
            '(^-|-$)', '', 'g'
        ) AS base
    FROM distinct_names
),
numbered AS (
    SELECT name, type, base, row_number() OVER (PARTITION BY base ORDER BY name) AS n
    FROM slugged
    WHERE base <> ''
)
INSERT INTO "Investor" (id, slug, name, type, "moderationStatus", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    CASE WHEN n = 1 THEN base ELSE base || '-' || n::text END,
    name,
    type,
    'APPROVED',
    now(),
    now()
FROM numbered;

-- 3. Link both tables by exact name.
UPDATE "InvestorHolding" h
SET "investorId" = i.id
FROM "Investor" i
WHERE i.name = h.name AND h."investorId" IS NULL;

UPDATE "RoundInvestor" r
SET "investorId" = i.id
FROM "Investor" i
WHERE i.name = r.name AND r."investorId" IS NULL;
