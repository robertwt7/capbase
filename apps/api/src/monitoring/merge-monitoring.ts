import type { Prisma } from '@repo/db';
/**
 * Run inside a company merge, before rows move. Both sides' approved rounds become seen for
 * every user monitoring either company (moved history is never "newly recorded"), and every
 * search that had seen the loser has now seen the survivor (merged data qualifying the
 * survivor is not a new match). Nothing is undone on unmerge: extra seen rows only suppress.
 */
export async function seedMergedRounds(
  tx: Prisma.TransactionClient,
  survivorId: string,
  losingId: string,
) {
  await tx.$executeRaw`INSERT INTO "MonitorSeenRound" ("userId","roundId") SELECT DISTINCT s."userId",r.id FROM "SavedCompany" s CROSS JOIN "FundingRound" r WHERE s."companyId" IN (${survivorId},${losingId}) AND s."monitoredAt" IS NOT NULL AND r."companyId" IN (${survivorId},${losingId}) AND r."moderationStatus"='APPROVED' ON CONFLICT DO NOTHING`;
  await tx.$executeRaw`INSERT INTO "MonitorSeenCompany" ("searchId","companyId") SELECT "searchId", ${survivorId} FROM "MonitorSeenCompany" WHERE "companyId" = ${losingId} ON CONFLICT DO NOTHING`;
}
