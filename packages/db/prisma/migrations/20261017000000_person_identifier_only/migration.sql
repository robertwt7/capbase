-- People created by an identifier-only source (a licensed partner's contacts)
-- are never matched by name; the flag lets the ingest index skip them without
-- loading their identifiers. Backfilled from the identifier crosswalk, so a
-- database that already holds partner people is correct at once (a no-op on
-- one that does not).
ALTER TABLE "Person" ADD COLUMN "identifierOnly" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Person" p SET "identifierOnly" = true
 WHERE EXISTS (
   SELECT 1 FROM "EntityIdentifier" e
    WHERE e."entityType" = 'person' AND e."entityId" = p.id AND e.scheme = 'PARTNER'
 );
