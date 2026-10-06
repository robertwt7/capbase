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

export const REVIEWABLE_TYPES: readonly ReviewableType[] = [
  'company',
  'round',
  'person',
  'investor',
  'acquisition',
  'exit',
  'diversity',
  'proposal',
];

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

/** Rows per page of the submission queue. Never unbounded: APPROVED holds
 *  every ingested row (hundreds of thousands), and loading them all ran the API
 *  out of heap. */
export const SUBMISSION_PAGE_SIZE = 50;

export interface PendingSubmissionsResponse {
  /** Every row in the status (or in the requested type), not just `items`. */
  total: number;
  /** Per-type totals for the status, whatever type was requested. */
  countsByType: Record<ReviewableType, number>;
  /** One page, newest first, at most `SUBMISSION_PAGE_SIZE`. */
  items: PendingSubmission[];
  /** Pass back as `before` for the next (older) page; null on the last one.
   *  A cursor, not a page number: the queue merges eight tables, and an offset
   *  would have to load every row above it from each of them. */
  nextCursor: string | null;
}

export interface ModerationDecisionInput {
  status: Extract<ReviewStatus, 'APPROVED' | 'REJECTED'>;
  /** Optional reason for a rejection, quoted in the email to the contributor.
   *  Not stored, and ignored on an approval. */
  note?: string | null;
}

/** Longest moderator note a rejection may carry. */
export const MODERATION_NOTE_MAX = 1000;

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

/** Candidate pairs per page of the merge queue. Each renders both sides, so a
 *  page costs a handful of queries per item. */
export const MERGE_PAGE_SIZE = 25;

export interface MergeQueueResponse {
  /** Every candidate in the status (and type), not just this page. */
  total: number;
  countsBySignal: Record<MergeSignal, number>;
  /** One page, strongest signal first, then newest. */
  items: MergeCandidateItem[];
  page: number;
  pageSize: number;
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
