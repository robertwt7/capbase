-- Synthetic investor focus for checking the Investment focus section before
-- any real partner data is loaded. LOCAL ONLY (make investor-focus-fixture
-- refuses anywhere else); remove with make investor-focus-fixture-remove.
--
-- Picks four deterministic local firms and prints their slugs:
--   1. a public SEC_ADV firm: both roles, long label lists (> 8), a EUR range
--   2. a public firm: manager only, a min-only range, no stages
--   3. a public firm: LP only, a max-only range
--   4. a partner-only firm: manager focus (exercises the stub)
-- Every row is tagged externalId 'fixture:<n>:<role>'. Labels are synthetic.
\set ON_ERROR_STOP on
BEGIN;

DELETE FROM "InvestorFocus" WHERE "externalId" LIKE 'fixture:%';

CREATE TEMP TABLE fixture_pick (n int PRIMARY KEY, id text NOT NULL, slug text NOT NULL) ON COMMIT DROP;

INSERT INTO fixture_pick
SELECT row_number() OVER (ORDER BY "holdingCount" DESC, slug)::int, id, slug
  FROM (SELECT id, slug, "holdingCount" FROM "Investor"
         WHERE "moderationStatus" = 'APPROVED' AND "mergedIntoId" IS NULL AND NOT "partnerOnly"
           AND "externalSource" = 'SEC_ADV'
         ORDER BY "holdingCount" DESC, slug
         LIMIT 3) public_firms;

INSERT INTO fixture_pick
SELECT 4, id, slug FROM "Investor"
 WHERE "moderationStatus" = 'APPROVED' AND "mergedIntoId" IS NULL AND "partnerOnly"
 ORDER BY slug
 LIMIT 1;

-- 1: both roles, long lists, EUR.
INSERT INTO "InvestorFocus" (id, "investorId", role, stages, "mainStrategy", strategies, industries, verticals, geographies,
                             "rangeMinUsd", "rangeMaxUsd", "rangeCurrency", "rangeMinLocal", "rangeMaxLocal",
                             "reportedOn", "snapshotDate", "externalSource", "externalId", "updatedAt")
SELECT 'fixture-1-manager', id, 'manager',
       ARRAY['Seed', 'Initial Round', 'Round B,C,D...', 'Follow-on'],
       'Venture Capital (All Stages)',
       ARRAY['Early Stage', 'Expansion / Late Stage', 'Growth'],
       ARRAY['Software', 'Healthcare IT', 'Biotechnology', 'Medical Devices', 'Financial Services', 'Insurance',
             'Energy', 'Clean Technology', 'Industrials', 'Logistics', 'Consumer Products', 'Media'],
       ARRAY['Fintech', 'Artificial Intelligence', 'Cybersecurity', 'Digital Health', 'Climate Tech',
             'Mobility', 'Agritech', 'Edtech', 'Proptech', 'Marketplaces'],
       ARRAY['US', 'Canada', 'UK', 'Germany', 'France', 'Netherlands', 'Sweden', 'Israel', 'India', 'Singapore'],
       1100000, 11000000, 'EUR', 1000000, 10000000,
       DATE '2025-06-30', DATE '2026-10-14', 'PARTNER', 'fixture:1:manager', now()
  FROM fixture_pick WHERE n = 1;
INSERT INTO "InvestorFocus" (id, "investorId", role, strategies, industries, verticals, geographies,
                             "rangeMinUsd", "rangeMaxUsd", "rangeCurrency", "rangeMinLocal", "rangeMaxLocal",
                             "reportedOn", "snapshotDate", "externalSource", "externalId", "updatedAt")
SELECT 'fixture-1-lp', id, 'lp',
       ARRAY['Venture Capital', 'Growth', 'Buyout', 'Secondaries', 'Fund of Funds', 'Co-investment',
             'Private Debt', 'Infrastructure', 'Real Estate'],
       ARRAY['Software', 'Healthcare IT'],
       ARRAY['Fintech'],
       ARRAY['North America', 'Europe', 'Asia'],
       22000000, 55000000, 'EUR', 20000000, 50000000,
       DATE '2026-03-31', DATE '2026-10-14', 'PARTNER', 'fixture:1:lp', now()
  FROM fixture_pick WHERE n = 1;

-- 2: manager only, min-only range, no stages.
INSERT INTO "InvestorFocus" (id, "investorId", role, "mainStrategy", strategies, industries, geographies,
                             "rangeMinUsd", "reportedOn", "snapshotDate", "externalSource", "externalId", "updatedAt")
SELECT 'fixture-2-manager', id, 'manager', 'Buyout', ARRAY['Mid-Market Buyout'], ARRAY['Industrials', 'Business Services'],
       ARRAY['US'], 5000000, DATE '2025-01-15', DATE '2026-10-14', 'PARTNER', 'fixture:2:manager', now()
  FROM fixture_pick WHERE n = 2;

-- 3: LP only, max-only range.
INSERT INTO "InvestorFocus" (id, "investorId", role, strategies, geographies,
                             "rangeMaxUsd", "reportedOn", "snapshotDate", "externalSource", "externalId", "updatedAt")
SELECT 'fixture-3-lp', id, 'lp', ARRAY['Venture Capital', 'Growth'], ARRAY['North America'],
       25000000, DATE '2025-11-01', DATE '2026-10-14', 'PARTNER', 'fixture:3:lp', now()
  FROM fixture_pick WHERE n = 3;

-- 4: partner-only firm, manager focus.
INSERT INTO "InvestorFocus" (id, "investorId", role, stages, industries, geographies,
                             "rangeMinUsd", "rangeMaxUsd", "reportedOn", "snapshotDate", "externalSource", "externalId", "updatedAt")
SELECT 'fixture-4-manager', id, 'manager', ARRAY['Seed'], ARRAY['Software'], ARRAY['UK'],
       500000, 2000000, DATE '2025-09-30', DATE '2026-10-14', 'PARTNER', 'fixture:4:manager', now()
  FROM fixture_pick WHERE n = 4;

SELECT p.n AS firm, '/investors/' || p.slug AS path, string_agg(f.role, ', ' ORDER BY f.role) AS roles
  FROM fixture_pick p LEFT JOIN "InvestorFocus" f ON f."investorId" = p.id AND f."externalId" LIKE 'fixture:%'
 GROUP BY p.n, p.slug ORDER BY p.n;

COMMIT;
