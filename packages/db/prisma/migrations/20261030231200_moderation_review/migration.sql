-- AlterTable
ALTER TABLE "AcquisitionDeal" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "ChangeProposal" ADD COLUMN     "clearedPartnerFields" JSONB,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "DiversitySignal" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "ExitEvent" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "FundingRound" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "InvestorChangeProposal" ADD COLUMN     "clearedPartnerFields" JSONB,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "InvestorHolding" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "PersonRole" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- CreateIndex
CREATE INDEX "AcquisitionDeal_moderationStatus_reviewedAt_id_idx" ON "AcquisitionDeal"("moderationStatus", "reviewedAt", "id");

-- CreateIndex
CREATE INDEX "ChangeProposal_moderationStatus_reviewedAt_id_idx" ON "ChangeProposal"("moderationStatus", "reviewedAt", "id");

-- CreateIndex
CREATE INDEX "Company_moderationStatus_reviewedAt_id_idx" ON "Company"("moderationStatus", "reviewedAt", "id");

-- CreateIndex
CREATE INDEX "DiversitySignal_moderationStatus_reviewedAt_id_idx" ON "DiversitySignal"("moderationStatus", "reviewedAt", "id");

-- CreateIndex
CREATE INDEX "ExitEvent_moderationStatus_reviewedAt_id_idx" ON "ExitEvent"("moderationStatus", "reviewedAt", "id");

-- CreateIndex
CREATE INDEX "FundingRound_moderationStatus_reviewedAt_id_idx" ON "FundingRound"("moderationStatus", "reviewedAt", "id");

-- CreateIndex
CREATE INDEX "InvestorChangeProposal_moderationStatus_reviewedAt_id_idx" ON "InvestorChangeProposal"("moderationStatus", "reviewedAt", "id");

-- CreateIndex
CREATE INDEX "InvestorHolding_moderationStatus_reviewedAt_id_idx" ON "InvestorHolding"("moderationStatus", "reviewedAt", "id");

-- CreateIndex
CREATE INDEX "PersonRole_moderationStatus_reviewedAt_id_idx" ON "PersonRole"("moderationStatus", "reviewedAt", "id");

-- Backfill (hand-written). Idempotent: every UPDATE only touches rows whose
-- "reviewedAt" is still NULL. Ingested rows (submittedById IS NULL) stay NULL.

-- Revisable types: the latest ADMIN CREATE revision is the approval.
UPDATE "Company" t SET "reviewedAt" = r."createdAt", "reviewedById" = r."actorUserId"
FROM (SELECT DISTINCT ON ("entityId") "entityId", "createdAt", "actorUserId"
      FROM "Revision" WHERE "entityType" = 'company' AND "action" = 'CREATE' AND "actor" = 'ADMIN'
      ORDER BY "entityId", "createdAt" DESC) r
WHERE t."id" = r."entityId" AND t."submittedById" IS NOT NULL
  AND t."moderationStatus" = 'APPROVED' AND t."reviewedAt" IS NULL;

UPDATE "FundingRound" t SET "reviewedAt" = r."createdAt", "reviewedById" = r."actorUserId"
FROM (SELECT DISTINCT ON ("entityId") "entityId", "createdAt", "actorUserId"
      FROM "Revision" WHERE "entityType" = 'round' AND "action" = 'CREATE' AND "actor" = 'ADMIN'
      ORDER BY "entityId", "createdAt" DESC) r
WHERE t."id" = r."entityId" AND t."submittedById" IS NOT NULL
  AND t."moderationStatus" = 'APPROVED' AND t."reviewedAt" IS NULL;

UPDATE "PersonRole" t SET "reviewedAt" = r."createdAt", "reviewedById" = r."actorUserId"
FROM (SELECT DISTINCT ON ("entityId") "entityId", "createdAt", "actorUserId"
      FROM "Revision" WHERE "entityType" = 'person' AND "action" = 'CREATE' AND "actor" = 'ADMIN'
      ORDER BY "entityId", "createdAt" DESC) r
WHERE t."id" = r."entityId" AND t."submittedById" IS NOT NULL
  AND t."moderationStatus" = 'APPROVED' AND t."reviewedAt" IS NULL;

UPDATE "InvestorHolding" t SET "reviewedAt" = r."createdAt", "reviewedById" = r."actorUserId"
FROM (SELECT DISTINCT ON ("entityId") "entityId", "createdAt", "actorUserId"
      FROM "Revision" WHERE "entityType" = 'investor' AND "action" = 'CREATE' AND "actor" = 'ADMIN'
      ORDER BY "entityId", "createdAt" DESC) r
WHERE t."id" = r."entityId" AND t."submittedById" IS NOT NULL
  AND t."moderationStatus" = 'APPROVED' AND t."reviewedAt" IS NULL;

UPDATE "AcquisitionDeal" t SET "reviewedAt" = r."createdAt", "reviewedById" = r."actorUserId"
FROM (SELECT DISTINCT ON ("entityId") "entityId", "createdAt", "actorUserId"
      FROM "Revision" WHERE "entityType" = 'acquisition' AND "action" = 'CREATE' AND "actor" = 'ADMIN'
      ORDER BY "entityId", "createdAt" DESC) r
WHERE t."id" = r."entityId" AND t."submittedById" IS NOT NULL
  AND t."moderationStatus" = 'APPROVED' AND t."reviewedAt" IS NULL;

UPDATE "ExitEvent" t SET "reviewedAt" = r."createdAt", "reviewedById" = r."actorUserId"
FROM (SELECT DISTINCT ON ("entityId") "entityId", "createdAt", "actorUserId"
      FROM "Revision" WHERE "entityType" = 'exit' AND "action" = 'CREATE' AND "actor" = 'ADMIN'
      ORDER BY "entityId", "createdAt" DESC) r
WHERE t."id" = r."entityId" AND t."submittedById" IS NOT NULL
  AND t."moderationStatus" = 'APPROVED' AND t."reviewedAt" IS NULL;

UPDATE "DiversitySignal" t SET "reviewedAt" = r."createdAt", "reviewedById" = r."actorUserId"
FROM (SELECT DISTINCT ON ("entityId") "entityId", "createdAt", "actorUserId"
      FROM "Revision" WHERE "entityType" = 'diversity' AND "action" = 'CREATE' AND "actor" = 'ADMIN'
      ORDER BY "entityId", "createdAt" DESC) r
WHERE t."id" = r."entityId" AND t."submittedById" IS NOT NULL
  AND t."moderationStatus" = 'APPROVED' AND t."reviewedAt" IS NULL;

-- ChangeProposal: its UPDATE revisions carry proposalId.
UPDATE "ChangeProposal" t SET "reviewedAt" = r."createdAt", "reviewedById" = r."actorUserId"
FROM (SELECT DISTINCT ON ("proposalId") "proposalId", "createdAt", "actorUserId"
      FROM "Revision" WHERE "proposalId" IS NOT NULL
      ORDER BY "proposalId", "createdAt" DESC) r
WHERE t."id" = r."proposalId" AND t."moderationStatus" = 'APPROVED' AND t."reviewedAt" IS NULL;

-- Everything decided and still unset (rejections, investor proposals, approvals with no
-- revision): updatedAt is the best available proxy; the reviewer is unknown.
UPDATE "Company" SET "reviewedAt" = "updatedAt"
WHERE "submittedById" IS NOT NULL AND "moderationStatus" <> 'PENDING' AND "reviewedAt" IS NULL;
UPDATE "FundingRound" SET "reviewedAt" = "updatedAt"
WHERE "submittedById" IS NOT NULL AND "moderationStatus" <> 'PENDING' AND "reviewedAt" IS NULL;
UPDATE "PersonRole" SET "reviewedAt" = "updatedAt"
WHERE "submittedById" IS NOT NULL AND "moderationStatus" <> 'PENDING' AND "reviewedAt" IS NULL;
UPDATE "InvestorHolding" SET "reviewedAt" = "updatedAt"
WHERE "submittedById" IS NOT NULL AND "moderationStatus" <> 'PENDING' AND "reviewedAt" IS NULL;
UPDATE "AcquisitionDeal" SET "reviewedAt" = "updatedAt"
WHERE "submittedById" IS NOT NULL AND "moderationStatus" <> 'PENDING' AND "reviewedAt" IS NULL;
UPDATE "ExitEvent" SET "reviewedAt" = "updatedAt"
WHERE "submittedById" IS NOT NULL AND "moderationStatus" <> 'PENDING' AND "reviewedAt" IS NULL;
UPDATE "DiversitySignal" SET "reviewedAt" = "updatedAt"
WHERE "submittedById" IS NOT NULL AND "moderationStatus" <> 'PENDING' AND "reviewedAt" IS NULL;
UPDATE "ChangeProposal" SET "reviewedAt" = "updatedAt"
WHERE "submittedById" IS NOT NULL AND "moderationStatus" <> 'PENDING' AND "reviewedAt" IS NULL;
UPDATE "InvestorChangeProposal" SET "reviewedAt" = "updatedAt"
WHERE "submittedById" IS NOT NULL AND "moderationStatus" <> 'PENDING' AND "reviewedAt" IS NULL;
