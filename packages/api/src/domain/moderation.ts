// Shapes for the admin moderation surface. The future admin portal (next phase)
// consumes these to render the review queue.

import type { ReviewStatus } from './company';

export type ReviewableType =
  | 'company'
  | 'round'
  | 'person'
  | 'investor'
  | 'acquisition'
  | 'exit'
  | 'diversity';

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
