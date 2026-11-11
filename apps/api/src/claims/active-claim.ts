import { normalizeDomain, type ClaimEndReason, type ClaimStatus } from '@repo/api';
import { Prisma } from '@repo/db';

/**
 * The ONE definition of an active company claim. Every reader — the contribution stamp, the
 * queue label and filter, revision attribution, the profile mark, the confirm action — goes
 * through this file. Nothing is stamped when a company's domain changes: an EMAIL claim is
 * re-checked against the current domain on every read, so a retracted domain edit restores it.
 */

type Db = Prisma.TransactionClient;

/** Rows that can be active at all. The domain rule is applied on top (see isActiveClaim). */
export const LIVE_CLAIM = {
  verifiedAt: { not: null },
  revokedAt: null,
  user: { bannedAt: null },
} satisfies Prisma.CompanyClaimWhereInput;

export interface ClaimFacts {
  method: string;
  domain: string;
  verifiedAt: Date | null;
  revokedAt: Date | null;
  user: { bannedAt: Date | null };
}

export interface ClaimCompanyFacts {
  domain: string;
  mergedIntoId: string | null;
}

/** Verified, not revoked, user not banned, company not merged away, and — for an EMAIL claim —
 *  the company still holds the domain the address was verified against. */
export function isActiveClaim(claim: ClaimFacts, company: ClaimCompanyFacts): boolean {
  if (!claim.verifiedAt || claim.revokedAt || claim.user.bannedAt || company.mergedIntoId) {
    return false;
  }
  return claim.method === 'MANUAL' || claim.domain === normalizeDomain(company.domain);
}

/** The derived status the owner and the admin pages show. */
export function claimStatus(claim: ClaimFacts, company: ClaimCompanyFacts): ClaimStatus {
  if (claim.revokedAt || claim.user.bannedAt) return 'ended';
  if (!claim.verifiedAt) return 'pending';
  return isActiveClaim(claim, company) ? 'active' : 'suspended';
}

export function claimEndReason(
  claim: ClaimFacts & { endReason: string | null },
): ClaimEndReason | null {
  if (claim.endReason) return claim.endReason as ClaimEndReason;
  return claim.user.bannedAt ? 'ban' : null;
}

const ACTIVE_INCLUDE = {
  user: { select: { bannedAt: true } },
  company: { select: { domain: true, mergedIntoId: true } },
} as const;

/** The caller's active claim on this company, or null. One indexed read. */
export async function activeClaimId(
  db: Db,
  userId: string,
  companyId: string,
): Promise<string | null> {
  const rows = await db.companyClaim.findMany({
    where: { userId, companyId, ...LIVE_CLAIM },
    include: ACTIVE_INCLUDE,
    orderBy: { verifiedAt: 'asc' },
  });
  return rows.find((r) => isActiveClaim(r, r.company))?.id ?? null;
}

/** Every active claim on one company (the profile mark). One indexed read. */
export async function activeClaimsOn(db: Db, companyId: string) {
  const rows = await db.companyClaim.findMany({
    where: { companyId, ...LIVE_CLAIM },
    include: ACTIVE_INCLUDE,
  });
  return rows.filter((r) => isActiveClaim(r, r.company));
}

/**
 * `normalizeDomain` restated in SQL, step for step (trim, lower-case, scheme, path/query/hash,
 * port, `www.`, trailing dot). `active-claim.spec.ts` and the claims e2e suite pin the two forms
 * to the same answers.
 */
export const NORMALIZED_COMPANY_DOMAIN = Prisma.sql`regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    lower(btrim(co."domain", E' \\t\\n\\r')),
    '^[a-z][a-z0-9+.-]*://', ''), '[/?#].*$', ''), ':[0-9]+$', ''), '^www\\.', ''), '\\.$', '')`;

/** Ids of every active claim, domain rule included, for the queue filter. One raw query. */
export async function activeClaimIds(db: Db): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM "CompanyClaim" c
    JOIN "Company" co ON co.id = c."companyId"
    JOIN "User" u ON u.id = c."userId"
    WHERE c."verifiedAt" IS NOT NULL AND c."revokedAt" IS NULL AND u."bannedAt" IS NULL
      AND co."mergedIntoId" IS NULL
      AND (c."method" = 'MANUAL' OR c."domain" = ${NORMALIZED_COMPANY_DOMAIN})`;
  return rows.map((r) => r.id);
}

/**
 * Label the user's still-PENDING submissions on this company with a claim that just became
 * active (an email link spent, a manual request approved). Rows already carrying a claim keep it.
 */
export async function stampPendingRows(
  tx: Db,
  userId: string,
  companyId: string,
  claimId: string,
): Promise<void> {
  const where = { submittedById: userId, companyId, moderationStatus: 'PENDING' as const, claimId: null };
  const data = { claimId };
  await Promise.all([
    tx.changeProposal.updateMany({ where, data }),
    tx.fundingRound.updateMany({ where, data }),
    tx.personRole.updateMany({ where, data }),
    tx.investorHolding.updateMany({ where, data }),
    tx.acquisitionDeal.updateMany({ where, data }),
    tx.exitEvent.updateMany({ where, data }),
    tx.diversitySignal.updateMany({ where, data }),
  ]);
}
