import type { Prisma } from '@repo/db';

/**
 * What the public may see.
 *
 * Two conditions, not one. `moderationStatus: 'APPROVED'` is the old rule — the
 * row was reviewed. `mergedIntoId: null` is the new one — the row was not
 * folded into another. A tombstone is kept rather than deleted (deleting it
 * would free its `(externalSource, externalId)` and the next ingest run would
 * recreate the duplicate), so every public read has to filter it out
 * explicitly.
 *
 * These live in one place so that filter is one edit rather than fourteen by
 * hand. `market.service.ts` builds raw SQL and carries the same two conditions
 * inline.
 */
export const PUBLIC_COMPANY = {
  moderationStatus: 'APPROVED',
  mergedIntoId: null,
} satisfies Prisma.CompanyWhereInput;

export const PUBLIC_INVESTOR = {
  moderationStatus: 'APPROVED',
  mergedIntoId: null,
} satisfies Prisma.InvestorWhereInput;

/** The same rule as a relation filter, for `where: { company: … }`. */
export const PUBLIC_COMPANY_RELATION = {
  moderationStatus: 'APPROVED' as const,
  mergedIntoId: null,
};

/**
 * How far a chain of merges is followed when resolving a tombstoned slug.
 *
 * A survivor can itself be merged later, so the chain has real length; a cycle
 * (only reachable through a bad unmerge or a manual edit) must not hang the
 * request. Lives here rather than in the merge service so the public read path
 * does not import from the admin module.
 */
export const MAX_MERGE_HOPS = 5;
