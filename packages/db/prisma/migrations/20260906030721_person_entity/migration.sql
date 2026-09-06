-- People as a first-class entity.
--
-- HAND-WRITTEN. `prisma migrate dev` emits DROP + CREATE for a renamed model,
-- which would destroy every Person row and orphan every Citation anchored to
-- one. This renames the table in place instead: the row ids never change, so
-- all `Citation` rows with entityType='person' stay anchored to exactly the
-- role they attest, and no citation pass is needed. The index and constraint
-- names below are the ones Postgres actually assigned (verified with
-- `\d "Person"`), not what Prisma would choose today.

-- 1. The old Person table IS the role edge. Rename it, and take its index and
--    constraint names with it — a later Prisma-generated migration looks them
--    up by name, and the names Person_* have to be free for the new table.
ALTER TABLE "Person" RENAME TO "PersonRole";

ALTER INDEX "Person_pkey" RENAME TO "PersonRole_pkey";
ALTER INDEX "Person_externalSource_externalId_key" RENAME TO "PersonRole_externalSource_externalId_key";
ALTER INDEX "Person_companyId_idx" RENAME TO "PersonRole_companyId_idx";
ALTER INDEX "Person_moderationStatus_idx" RENAME TO "PersonRole_moderationStatus_idx";

ALTER TABLE "PersonRole" RENAME CONSTRAINT "Person_companyId_fkey" TO "PersonRole_companyId_fkey";
ALTER TABLE "PersonRole" RENAME CONSTRAINT "Person_submittedById_fkey" TO "PersonRole_submittedById_fkey";

-- 2. A role now hangs off a company OR an investor firm, so companyId can no
--    longer be required. Every row that predates this has one.
ALTER TABLE "PersonRole" ALTER COLUMN "companyId" DROP NOT NULL;

ALTER TABLE "PersonRole" ADD COLUMN "personId" TEXT;
ALTER TABLE "PersonRole" ADD COLUMN "investorId" TEXT;
ALTER TABLE "PersonRole" ADD COLUMN "kind" TEXT;
ALTER TABLE "PersonRole" ADD COLUMN "endYear" INTEGER;

CREATE INDEX "PersonRole_investorId_idx" ON "PersonRole"("investorId");
CREATE INDEX "PersonRole_personId_idx" ON "PersonRole"("personId");

-- 3. The new Person entity: one row per human, filled by backfill-people.
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "mergedIntoId" TEXT,
    "suppressedAt" TIMESTAMP(3),
    "moderationStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Person_slug_key" ON "Person"("slug");
CREATE INDEX "Person_normalizedName_idx" ON "Person"("normalizedName");
CREATE INDEX "Person_mergedIntoId_idx" ON "Person"("mergedIntoId");
CREATE INDEX "Person_moderationStatus_idx" ON "Person"("moderationStatus");
CREATE INDEX "Person_moderationStatus_name_idx" ON "Person"("moderationStatus", "name");

ALTER TABLE "Person" ADD CONSTRAINT "Person_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. The two new edges out of a role row.
ALTER TABLE "PersonRole" ADD CONSTRAINT "PersonRole_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonRole" ADD CONSTRAINT "PersonRole_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
