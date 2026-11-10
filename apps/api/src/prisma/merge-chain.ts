import type { PrismaService } from './prisma.service';
import { MAX_MERGE_HOPS } from './public-filters';

/** The live firm a slug answers to. */
export interface InvestorSurvivor {
  id: string;
  slug: string;
  name: string;
  partnerOnly: boolean;
}

const SELECT = {
  id: true,
  slug: true,
  name: true,
  partnerOnly: true,
  mergedIntoId: true,
  moderationStatus: true,
} as const;

/**
 * The live, approved firm `slug` names: the row itself, or — when it was merged
 * away — the survivor at the end of its merge chain. Null for an unknown slug,
 * a firm that is not approved, or a chain that breaks or runs past
 * `MAX_MERGE_HOPS` (a cycle must not hang the request).
 */
export async function resolveInvestorSurvivor(prisma: PrismaService, slug: string): Promise<InvestorSurvivor | null> {
  let row = await prisma.investor.findUnique({ where: { slug }, select: SELECT });
  for (let hop = 0; row?.mergedIntoId && hop < MAX_MERGE_HOPS; hop++) {
    row = await prisma.investor.findUnique({ where: { id: row.mergedIntoId }, select: SELECT });
  }
  if (!row || row.mergedIntoId || row.moderationStatus !== 'APPROVED') return null;
  return { id: row.id, slug: row.slug, name: row.name, partnerOnly: row.partnerOnly };
}
