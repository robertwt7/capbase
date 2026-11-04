-- Synthetic fund mandates for checking the Investment mandate and Fund
-- structure sections before any real partner data is loaded. LOCAL ONLY (make
-- fund-mandate-fixture refuses anywhere else); remove with
-- make fund-mandate-fixture-remove.
--
-- Picks four deterministic local funds that hold no mandate and prints their slugs:
--   1. a public SEC_ADV_FUNDS fund with everything: > 8 industries, verticals,
--      a one-label focus, a 6-label exposure, Delaware / Commingled / LP
--   2. a public fund with a strategy and a geographic focus only (no structure)
--   3. a public fund with a structure only (no mandate labels)
--   4. a partner-only fund with a full mandate (exercises the stub) — only while
--      one holds no mandate: after a v3 funds-stage run every partner fund has a
--      real one, so check the stub on a real partner-only fund instead.
-- Every fixture row carries the sentinel mandateReportedOn = 2000-01-01.
-- Labels are synthetic.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE fixture_pick (n int PRIMARY KEY, id text NOT NULL, slug text NOT NULL) ON COMMIT DROP;

INSERT INTO fixture_pick
SELECT row_number() OVER (ORDER BY "sizeUsd" DESC NULLS LAST, slug)::int, id, slug
  FROM (SELECT id, slug, "sizeUsd" FROM "Fund"
         WHERE "moderationStatus" = 'APPROVED' AND NOT "partnerOnly" AND slug IS NOT NULL
           AND "externalSource" = 'SEC_ADV_FUNDS' AND "mandateReportedOn" IS NULL
         ORDER BY "sizeUsd" DESC NULLS LAST, slug
         LIMIT 3) public_funds;

INSERT INTO fixture_pick
SELECT 4, id, slug FROM "Fund"
 WHERE "moderationStatus" = 'APPROVED' AND "partnerOnly" AND slug IS NOT NULL AND "mandateReportedOn" IS NULL
 ORDER BY "sizeUsd" DESC NULLS LAST, slug
 LIMIT 1;

-- 1: everything, long lists.
UPDATE "Fund" f SET
  "detailedStrategy" = 'Early Stage: Seed',
  industries = ARRAY['Software', 'Healthcare IT', 'Biotechnology', 'Medical Devices & Equipment',
                     'Financial Services', 'Insurance', 'Clean Technology', 'Industrials',
                     'Logistics & Distribution', 'Automobiles, Other Vehicles & Parts', 'Consumer Products', 'Media'],
  verticals = ARRAY['Fintech', 'Artificial Intelligence', 'Cybersecurity', 'Digital Health'],
  "geographicFocus" = ARRAY['North America'],
  "geographicExposure" = ARRAY['North America', 'US', 'Europe', 'UK', 'Israel', 'Hong Kong SAR - China'],
  domicile = 'Delaware', structure = 'Commingled', "legalStructure" = 'Limited Partnership',
  "mandateReportedOn" = DATE '2000-01-01'
  FROM fixture_pick p WHERE p.n = 1 AND f.id = p.id;

-- 2: strategy and focus only.
UPDATE "Fund" f SET
  "detailedStrategy" = 'Buyout', "geographicFocus" = ARRAY['Europe'],
  "mandateReportedOn" = DATE '2000-01-01'
  FROM fixture_pick p WHERE p.n = 2 AND f.id = p.id;

-- 3: structure only.
UPDATE "Fund" f SET
  domicile = 'Luxembourg', structure = 'Commingled', "legalStructure" = 'Luxembourg SCSp',
  "mandateReportedOn" = DATE '2000-01-01'
  FROM fixture_pick p WHERE p.n = 3 AND f.id = p.id;

-- 4: partner-only fund, full mandate.
UPDATE "Fund" f SET
  "detailedStrategy" = 'Venture (General)', industries = ARRAY['Software', 'Diversified'],
  "geographicFocus" = ARRAY['Global'], "geographicExposure" = ARRAY['Global', 'North America'],
  domicile = 'Cayman Islands', structure = 'Commingled', "legalStructure" = 'Exempted Limited Partnership',
  "mandateReportedOn" = DATE '2000-01-01'
  FROM fixture_pick p WHERE p.n = 4 AND f.id = p.id;

SELECT p.n AS fund, '/funds/' || p.slug AS path FROM fixture_pick p ORDER BY p.n;
SELECT 'no partner-only fund without a mandate: check the stub on a real one, e.g. /funds/' || slug AS fund_4
  FROM "Fund"
 WHERE NOT EXISTS (SELECT 1 FROM fixture_pick WHERE n = 4)
   AND "partnerOnly" AND "mandateReportedOn" IS NOT NULL AND slug IS NOT NULL
 ORDER BY "sizeUsd" DESC NULLS LAST, slug
 LIMIT 1;

COMMIT;
