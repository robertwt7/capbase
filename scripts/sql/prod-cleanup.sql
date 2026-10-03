-- Strip a COPY of the local database down to real data before it ships to
-- production (`make db-dump-prod`). Never run against the live local DB: the
-- e2e suite and local dev rely on the demo rows this removes.
--
-- Removes:
--   • the demo seed companies (phase 002) and the stray `test-company`
--   • every e2e test account (@test.dev) and everything it submitted
--   • the seeded demo account contributor@capbase.fyi
--   • persons / investors / sources that ONLY those rows referenced
--
-- "Only referenced by demo rows" is computed as a delta: collect what the demo
-- rows point at first, delete the demo rows, then delete just the collected ids
-- that are now referenced by nothing. A blanket "sourceless investor" rule would
-- take real Wikidata-linked firms with it.
--
-- SeedHistory is left intact on purpose: phases 002/003 stay recorded, so a
-- seed run on production can never put the demo companies back.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE demo_company AS
  SELECT id FROM "Company"
  WHERE slug IN ('helia','vellum','sable-labs','gridpoint','meridian','quill','palette',
                 'beacon-hr','test-company');

CREATE TEMP TABLE junk_user AS
  SELECT id FROM "User"
  WHERE email LIKE '%@test.dev' OR email = 'contributor@capbase.fyi';

-- What the doomed rows point at, captured before they go.
CREATE TEMP TABLE touched_person AS
  SELECT DISTINCT "personId" AS id FROM "PersonRole"
  WHERE "personId" IS NOT NULL
    AND ("companyId" IN (SELECT id FROM demo_company) OR "submittedById" IN (SELECT id FROM junk_user));

CREATE TEMP TABLE touched_investor AS
  SELECT "investorId" AS id FROM "InvestorHolding"
    WHERE "investorId" IS NOT NULL
      AND ("companyId" IN (SELECT id FROM demo_company) OR "submittedById" IN (SELECT id FROM junk_user))
  UNION
  SELECT ri."investorId" FROM "RoundInvestor" ri JOIN "FundingRound" r ON r.id = ri."roundId"
    WHERE ri."investorId" IS NOT NULL
      AND (r."companyId" IN (SELECT id FROM demo_company) OR r."submittedById" IN (SELECT id FROM junk_user))
  UNION
  SELECT id FROM "Investor" WHERE "submittedById" IN (SELECT id FROM junk_user);

-- 1. Everything the junk accounts submitted, on any company. (Their FKs are
--    ON DELETE SET NULL, so deleting the users alone would leave the rows.)
DELETE FROM "Citation"        WHERE "submittedById" IN (SELECT id FROM junk_user);
DELETE FROM "ChangeProposal"  WHERE "submittedById" IN (SELECT id FROM junk_user);
DELETE FROM "FundingRound"    WHERE "submittedById" IN (SELECT id FROM junk_user);
DELETE FROM "PersonRole"      WHERE "submittedById" IN (SELECT id FROM junk_user);
DELETE FROM "InvestorHolding" WHERE "submittedById" IN (SELECT id FROM junk_user);
DELETE FROM "AcquisitionDeal" WHERE "submittedById" IN (SELECT id FROM junk_user);
DELETE FROM "ExitEvent"       WHERE "submittedById" IN (SELECT id FROM junk_user);
DELETE FROM "DiversitySignal" WHERE "submittedById" IN (SELECT id FROM junk_user);
DELETE FROM "Revision"        WHERE "actorUserId"   IN (SELECT id FROM junk_user);

-- 2. Demo companies. Children (rounds, roles, holdings, deals, exits, signals,
--    proposals, saves, revisions) cascade.
DELETE FROM "Company" WHERE id IN (SELECT id FROM demo_company);

-- 3. Firms and people that existed only for the rows above.
DELETE FROM "Investor" i
WHERE i.id IN (SELECT id FROM touched_investor)
  AND i."externalSource" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "InvestorHolding" h WHERE h."investorId" = i.id)
  AND NOT EXISTS (SELECT 1 FROM "RoundInvestor"   r WHERE r."investorId" = i.id)
  AND NOT EXISTS (SELECT 1 FROM "PersonRole"      p WHERE p."investorId" = i.id)
  AND NOT EXISTS (SELECT 1 FROM "Fund"            f WHERE f."managerId"  = i.id)
  AND NOT EXISTS (SELECT 1 FROM "Investor"        m WHERE m."mergedIntoId" = i.id);

DELETE FROM "Person" p
WHERE p.id IN (SELECT id FROM touched_person)
  AND NOT EXISTS (SELECT 1 FROM "PersonRole" r WHERE r."personId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "Person" m WHERE m."mergedIntoId" = p.id);

-- 4. Polymorphic rows whose entity no longer exists.
DELETE FROM "Citation" c WHERE NOT CASE c."entityType"
    WHEN 'company'     THEN EXISTS (SELECT 1 FROM "Company"         x WHERE x.id = c."entityId")
    WHEN 'round'       THEN EXISTS (SELECT 1 FROM "FundingRound"    x WHERE x.id = c."entityId")
    -- 'person' and 'investor' are overloaded: a citation may anchor to the role /
    -- holding row OR to the person / firm itself (e.g. a CRD → IAPD firm citation).
    WHEN 'person'      THEN EXISTS (SELECT 1 FROM "PersonRole"      x WHERE x.id = c."entityId")
                         OR EXISTS (SELECT 1 FROM "Person"          x WHERE x.id = c."entityId")
    WHEN 'investor'    THEN EXISTS (SELECT 1 FROM "InvestorHolding" x WHERE x.id = c."entityId")
                         OR EXISTS (SELECT 1 FROM "Investor"        x WHERE x.id = c."entityId")
    WHEN 'acquisition' THEN EXISTS (SELECT 1 FROM "AcquisitionDeal" x WHERE x.id = c."entityId")
    WHEN 'exit'        THEN EXISTS (SELECT 1 FROM "ExitEvent"       x WHERE x.id = c."entityId")
    WHEN 'diversity'   THEN EXISTS (SELECT 1 FROM "DiversitySignal" x WHERE x.id = c."entityId")
    WHEN 'fund'        THEN EXISTS (SELECT 1 FROM "Fund"            x WHERE x.id = c."entityId")
    ELSE TRUE END;

DELETE FROM "Source" s WHERE NOT EXISTS (SELECT 1 FROM "Citation" c WHERE c."sourceId" = s.id);

DELETE FROM "EntityIdentifier" e WHERE NOT CASE e."entityType"
    WHEN 'company'  THEN EXISTS (SELECT 1 FROM "Company"  x WHERE x.id = e."entityId")
    WHEN 'investor' THEN EXISTS (SELECT 1 FROM "Investor" x WHERE x.id = e."entityId")
    WHEN 'person'   THEN EXISTS (SELECT 1 FROM "Person"   x WHERE x.id = e."entityId")
    ELSE TRUE END;

DELETE FROM "MergeCandidate" m WHERE NOT CASE m."entityType"
    WHEN 'company'  THEN EXISTS (SELECT 1 FROM "Company"  x WHERE x.id = m."leftId")
                     AND EXISTS (SELECT 1 FROM "Company"  x WHERE x.id = m."rightId")
    WHEN 'investor' THEN EXISTS (SELECT 1 FROM "Investor" x WHERE x.id = m."leftId")
                     AND EXISTS (SELECT 1 FROM "Investor" x WHERE x.id = m."rightId")
    WHEN 'person'   THEN EXISTS (SELECT 1 FROM "Person"   x WHERE x.id = m."leftId")
                     AND EXISTS (SELECT 1 FROM "Person"   x WHERE x.id = m."rightId")
    ELSE TRUE END;

-- 5. The accounts themselves.
DELETE FROM "User" WHERE id IN (SELECT id FROM junk_user);

-- Safety net: refuse to ship if anything demo-shaped survived.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Company" WHERE slug IN ('helia','test-company'))
     OR EXISTS (SELECT 1 FROM "User" WHERE email LIKE '%@test.dev')
     OR EXISTS (SELECT 1 FROM "FundingRound" WHERE name LIKE 'E2E Round%') THEN
    RAISE EXCEPTION 'demo/test rows survived the cleanup';
  END IF;
END $$;

COMMIT;
