import { Prisma, type PrismaClient } from './generated/prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** What to recompute. Omitted → everyone. `companyIds` expands to the people
 *  with a role and the investors with a holding on those companies. */
export interface DirectoryCountScope {
  personIds?: string[];
  investorIds?: string[];
  companyIds?: string[];
}

/**
 * Recompute the stored directory sort keys: `Person.roleCount` /
 * `Person.companyCount` and `Investor.holdingCount`.
 *
 * The predicates restate PUBLIC_ROLES / PUBLIC_HOLDINGS
 * (apps/api/src/prisma/public-filters.ts, investors.service.ts) — keep them in
 * step. Partner rows count for every viewer: a count is public. A firm-officer
 * role (no company) adds to `roleCount` but not `companyCount`, because
 * `count(DISTINCT companyId)` ignores NULL.
 *
 * Writes only rows whose value changed, so a re-run on unchanged data writes 0.
 * Not wrapped in a transaction: the full pass takes seconds, and each table's
 * statement is atomic on its own.
 */
export async function refreshDirectoryCounts(
  db: Db,
  scope?: DirectoryCountScope,
): Promise<{ people: number; investors: number }> {
  if (!scope) {
    return { people: await db.$executeRaw(peopleSql(null)), investors: await db.$executeRaw(investorsSql(null)) };
  }
  const personIds = unique(scope.personIds);
  const investorIds = unique(scope.investorIds);
  const companyIds = unique(scope.companyIds);
  // An empty scope recomputes nothing — never everyone.
  const people =
    personIds.length || companyIds.length ? await db.$executeRaw(peopleSql({ ids: personIds, companyIds })) : 0;
  const investors =
    investorIds.length || companyIds.length
      ? await db.$executeRaw(investorsSql({ ids: investorIds, companyIds }))
      : 0;
  return { people, investors };
}

interface Target {
  ids: string[];
  companyIds: string[];
}

function unique(ids: string[] | undefined): string[] {
  return [...new Set((ids ?? []).filter(Boolean))];
}

/** `AND <col> IN (SELECT id FROM target)` in the scoped form, nothing in the full one. */
const inTarget = (target: Target | null, col: Prisma.Sql) =>
  target ? Prisma.sql`AND ${col} IN (SELECT id FROM target)` : Prisma.empty;

function peopleSql(target: Target | null): Prisma.Sql {
  const targetCte = target
    ? Prisma.sql`target AS (
        SELECT unnest(${target.ids}::text[]) AS id
        UNION
        SELECT r."personId" FROM "PersonRole" r
         WHERE r."companyId" = ANY(${target.companyIds}::text[]) AND r."personId" IS NOT NULL
      ),`
    : Prisma.empty;
  return Prisma.sql`
    WITH ${targetCte}
    counts AS (
      SELECT r."personId" AS id,
             count(*)::int                      AS roles,
             count(DISTINCT r."companyId")::int AS companies
        FROM "PersonRole" r
        LEFT JOIN "Company" c ON c.id = r."companyId"
       WHERE r."personId" IS NOT NULL
         AND r."moderationStatus" = 'APPROVED'
         AND (r."companyId" IS NULL
              OR (c."moderationStatus" = 'APPROVED' AND c."mergedIntoId" IS NULL))
         ${inTarget(target, Prisma.sql`r."personId"`)}
       GROUP BY r."personId"
    )
    UPDATE "Person" p
       SET "roleCount" = v.roles, "companyCount" = v.companies
      FROM (SELECT t.id, COALESCE(k.roles, 0) AS roles, COALESCE(k.companies, 0) AS companies
              FROM "Person" t
              LEFT JOIN counts k ON k.id = t.id
             WHERE TRUE ${inTarget(target, Prisma.sql`t.id`)}
           ) v
     WHERE p.id = v.id
       AND (p."roleCount", p."companyCount") IS DISTINCT FROM (v.roles, v.companies)
  `;
}

function investorsSql(target: Target | null): Prisma.Sql {
  const targetCte = target
    ? Prisma.sql`target AS (
        SELECT unnest(${target.ids}::text[]) AS id
        UNION
        SELECT h."investorId" FROM "InvestorHolding" h
         WHERE h."companyId" = ANY(${target.companyIds}::text[]) AND h."investorId" IS NOT NULL
      ),`
    : Prisma.empty;
  return Prisma.sql`
    WITH ${targetCte}
    counts AS (
      SELECT h."investorId" AS id, count(*)::int AS holdings
        FROM "InvestorHolding" h
        JOIN "Company" c ON c.id = h."companyId"
       WHERE h."investorId" IS NOT NULL
         AND h."moderationStatus" = 'APPROVED'
         AND c."moderationStatus" = 'APPROVED'
         AND c."mergedIntoId" IS NULL
         ${inTarget(target, Prisma.sql`h."investorId"`)}
       GROUP BY h."investorId"
    )
    UPDATE "Investor" i
       SET "holdingCount" = v.holdings
      FROM (SELECT t.id, COALESCE(k.holdings, 0) AS holdings
              FROM "Investor" t
              LEFT JOIN counts k ON k.id = t.id
             WHERE TRUE ${inTarget(target, Prisma.sql`t.id`)}
           ) v
     WHERE i.id = v.id
       AND i."holdingCount" IS DISTINCT FROM v.holdings
  `;
}
