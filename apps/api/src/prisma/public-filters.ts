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

/**
 * Three conditions, not two.
 *
 * Beyond approved-and-not-merged, a person can be SUPPRESSED: the privacy
 * policy (§6) promises removal on request, and ingest auto-approves on every
 * run, so a suppression has to be its own column that both the read path and
 * the ingest match index honour — flipping `moderationStatus` would be undone
 * by the next cron.
 *
 * `PeopleService.listSlugs` restates these three in raw SQL — keep it in step.
 */
export const PUBLIC_PERSON = {
  moderationStatus: 'APPROVED',
  mergedIntoId: null,
  suppressedAt: null,
} satisfies Prisma.PersonWhereInput;

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
