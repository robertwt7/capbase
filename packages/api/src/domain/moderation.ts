// Shapes for the admin moderation surface. The future admin portal (next phase)
// consumes these to render the review queue.

import type { ReviewStatus } from './company';
import type { EntityIdentifierRef, IdentifiableType } from './identifiers';

export type ReviewableType =
  | 'company'
  | 'round'
  | 'person'
  | 'investor'
  | 'acquisition'
  | 'exit'
  | 'diversity'
  | 'proposal';

/** A single row awaiting (or having undergone) moderation. */
export interface PendingSubmission {
  type: ReviewableType;
  id: string;
  /** Human-readable summary of what the row represents. */
  label: string;
  /** The company this contribution belongs to (absent for a brand-new company). */
  companySlug: string | null;
  companyName: string | null;
  moderationStatus: ReviewStatus;
  submittedBy: { id: string; name: string; email: string } | null;
  createdAt: string;
  /** The primary document the contributor cited, so a moderator can check the
      source before approving. Null when they cited nothing. */
  sourceUrl: string | null;
  /** The contribution payload itself. */
  data: unknown;
}

export interface PendingSubmissionsResponse {
  total: number;
  countsByType: Record<ReviewableType, number>;
  items: PendingSubmission[];
}

export interface ModerationDecisionInput {
  status: Extract<ReviewStatus, 'APPROVED' | 'REJECTED'>;
}

// --- Merge queue -----------------------------------------------------------
// Two rows that describe the same entity, and what an admin does about it. A
// merge is same-type only: a company and an investor row that share a CIK are
// one organisation with two roles (Wefunder, Republic), not a duplicate.

/** Why a pair was proposed, strongest evidence first. An identifier is a
 *  statement by the publisher; a shared domain is a strong inference; a shared
 *  normalized name is a weak one. */
export type MergeSignal = 'identifier' | 'domain' | 'name';

export const MERGE_SIGNALS: readonly MergeSignal[] = ['identifier', 'domain', 'name'];

export type MergeStatus = 'PENDING' | 'MERGED' | 'REJECTED';

export const MERGE_STATUSES: readonly MergeStatus[] = ['PENDING', 'MERGED', 'REJECTED'];

/** One side of a candidate: identity, the fields a reviewer diffs, and the
 *  child counts that usually decide which row survives. */
export interface MergeSide {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  hq: string | null;
  externalSource: string | null;
  externalId: string | null;
  createdAt: string;
  identifiers: EntityIdentifierRef[];
  /** rounds/people/investors/… for a company; holdings/funds for an investor. */
  counts: Record<string, number>;
}

/** One candidate pair, with both sides rendered enough to decide on. */
export interface MergeCandidateItem {
  id: string;
  entityType: IdentifiableType;
  signal: MergeSignal;
  /** The value that matched ('CIK:0001234567', 'acme.com'), so the reviewer can
   *  check the proposal rather than guess why it was made. */
  evidence: string;
  status: MergeStatus;
  createdAt: string;
  left: MergeSide;
  right: MergeSide;
  /** Set once merged, so the queue can offer an unmerge. */
  mergeRecordId?: string | null;
}

export interface MergeQueueResponse {
  total: number;
  countsBySignal: Record<MergeSignal, number>;
  items: MergeCandidateItem[];
}

/** Admin picks which of the pair survives. */
export interface MergeDecisionInput {
  survivorId: string;
}

/** Queue a pair the detector missed. */
export interface ManualMergeCandidateInput {
  entityType: IdentifiableType;
  leftId: string;
  rightId: string;
}
