import {
  canonicalWebsiteTarget,
  gateLimit,
  WEBSITE_EXPIRY_MS,
  type CompanyApp,
  type CompanyTechnology,
  type ViewerAccess,
} from '@repo/api';

import type { PrismaService } from '../prisma/prisma.service';

/** Detail-only projection. Duplicate audit rows never supply a newer positive observation. */
export async function loadCompanyTechnology(
  prisma: PrismaService,
  company: { id: string; websiteUrl: string | null; domain: string },
  access: ViewerAccess,
  now = new Date(),
): Promise<{
  companyTechnologies: CompanyTechnology[];
  companyApps: CompanyApp[];
  totals: { companyTechnologies: number; companyApps: number };
}> {
  const targetUrl = canonicalWebsiteTarget(company.websiteUrl, company.domain);
  const empty = { companyTechnologies: [], companyApps: [], totals: { companyTechnologies: 0, companyApps: 0 } };
  if (!targetUrl) return empty;
  const cutoff = new Date(now.getTime() - WEBSITE_EXPIRY_MS);
  const scan = await prisma.companyWebsiteScan.findFirst({
    where: { companyId: company.id, targetUrl },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  let technologies: CompanyTechnology[] = [];
  let technologyCount = 0;
  if (scan) {
    // Suppression is group-wide, including unelected merge duplicates. It is
    // intentionally independent of retirement and observation expiry.
    const suppressed = await prisma.companyTechnology.findMany({
      where: { scan: { companyId: company.id, targetUrl }, suppressedAt: { not: null } },
      distinct: ['technologyId'],
      select: { technologyId: true },
    });
    const where = {
      scanId: scan.id,
      retiredAt: null,
      lastSeenAt: { gt: cutoff },
      technologyId: { notIn: suppressed.map((row) => row.technologyId) },
    };
    const limit = gateLimit('companyTechnologies', access);
    const [total, rows] = await Promise.all([
      prisma.companyTechnology.count({ where }),
      prisma.companyTechnology.findMany({
        where,
        include: { technology: true },
        orderBy: [{ technology: { category: 'asc' } }, { technology: { name: 'asc' } }, { id: 'asc' }],
        ...(Number.isFinite(limit) ? { take: limit } : {}),
      }),
    ]);
    technologyCount = total;
    technologies = rows.map((row) => ({
      id: row.id,
      slug: row.technology.slug,
      name: row.technology.name,
      category: row.technology.category,
      vendorUrl: row.technology.vendorUrl,
      evidenceUrl: row.evidenceUrl,
      evidence: row.evidence,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
    }));
  }

  type AppRow = Omit<CompanyApp, 'verifiedAt' | 'lastSeenAt'> & { verifiedAt: Date; lastSeenAt: Date; total: number };
  // Election and suppression happen before freshness, counting and limits. In
  // particular a newer duplicate cannot resurrect an expired elected link.
  const appLimit = gateLimit('companyApps', access);
  const apps = await prisma.$queryRaw<AppRow[]>`
    WITH ranked AS (
      SELECT a.*, r.store, r."appId", r."storeUrl",
        ROW_NUMBER() OVER (PARTITION BY a."resourceId" ORDER BY a."createdAt", a.id) AS ordinal,
        BOOL_OR(a."suppressedAt" IS NOT NULL) OVER (PARTITION BY a."resourceId") AS suppressed
      FROM "CompanyApp" a JOIN "AppResource" r ON r.id = a."resourceId"
      WHERE a."companyId" = ${company.id} AND a."targetUrl" = ${targetUrl}
    )
    SELECT id, store, "appId", "storeUrl", "evidenceUrl", "verifiedAt", "lastSeenAt",
      COUNT(*) OVER()::int AS total
    FROM ranked
    WHERE ordinal = 1 AND NOT suppressed AND "verifiedAt" IS NOT NULL
      AND "lastSeenAt" > ${cutoff} AND store IN ('APPLE', 'GOOGLE_PLAY')
    ORDER BY store, "appId", id
    LIMIT ${Number.isFinite(appLimit) ? appLimit : null}
  `;
  return {
    companyTechnologies: technologies,
    companyApps: apps.map((row) => ({
      id: row.id,
      store: row.store,
      appId: row.appId,
      storeUrl: row.storeUrl,
      evidenceUrl: row.evidenceUrl,
      verifiedAt: row.verifiedAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
    })),
    totals: { companyTechnologies: technologyCount, companyApps: apps[0]?.total ?? 0 },
  };
}
