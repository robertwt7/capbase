// Shapes for contribution-gated reads and the user's own contribution history.
// A non-contributing viewer sees only a preview of each company detail section;
// full access is earned by contributing and kept alive by a rolling window.

import type { Company, ReviewStatus } from './company';
import type { ReviewableType } from './moderation';

// Rows shown per detail section to a locked (non-contributing) viewer.
export const PREVIEW_LIMIT = 2;
// Rolling window: a contribution keeps full access alive for this many days.
export const CONTRIBUTION_WINDOW_DAYS = 30;

export interface CompanyAccess {
  /** True if the viewer is an admin or has contributed within the window. */
  unlocked: boolean;
  /** Rows shown per section when locked. */
  previewLimit: number;
  /** ISO timestamp full access expires (latest contribution + window), or null. */
  unlockedUntil: string | null;
  /** Full section counts so a locked UI can say "2 of N". */
  totals: {
    rounds: number;
    people: number;
    investors: number;
    acquisitions: number;
    exits: number;
    diversity: number;
  };
}

export interface CompanyDetailResponse {
  /** Sections are already truncated to previewLimit when access is locked. */
  company: Company;
  access: CompanyAccess;
}

export interface MyContribution {
  type: ReviewableType;
  id: string;
  label: string;
  companySlug: string | null;
  companyName: string | null;
  moderationStatus: ReviewStatus;
  createdAt: string;
}

export interface MyContributionsResponse {
  access: { unlocked: boolean; unlockedUntil: string | null };
  items: MyContribution[];
}
