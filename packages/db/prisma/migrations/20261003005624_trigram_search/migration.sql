-- Trigram indexes for directory search. Every directory filters with Prisma's
-- `contains` + `mode: 'insensitive'`, i.e. `ILIKE '%q%'`, which no btree index
-- can serve; a GIN trigram index can, so the query code does not change.
--
-- pg_trgm is a trusted extension (PG13+), so the database owner can create it
-- without superuser. The indexes are declared in schema.prisma too
-- (`type: Gin`, `ops: raw("gin_trgm_ops")`), so `prisma migrate dev` sees no
-- drift and never proposes dropping them.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Company_name_trgm_idx" ON "Company" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Company_oneLiner_trgm_idx" ON "Company" USING GIN ("oneLiner" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Fund_name_trgm_idx" ON "Fund" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Investor_name_trgm_idx" ON "Investor" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Person_name_trgm_idx" ON "Person" USING GIN ("name" gin_trgm_ops);
