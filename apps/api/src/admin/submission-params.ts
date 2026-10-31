import { BadRequestException } from '@nestjs/common';
import {
  REVIEWABLE_TYPES,
  SUBMISSION_QUERY_MAX,
  SUBMISSION_QUERY_MIN,
  SUBMISSION_SOURCES,
  type ReviewableType,
  type ReviewStatus,
  type SubmissionSource,
} from '@repo/api';

const REVIEW_STATUSES: readonly ReviewStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

/** The queue's `?status=` (default PENDING). Shared by /admin and /v1 so both validate alike. */
export function parseReviewStatus(status: string | undefined): ReviewStatus {
  const resolved = (status ?? 'PENDING') as ReviewStatus;
  if (!REVIEW_STATUSES.includes(resolved)) {
    throw new BadRequestException(`Invalid status "${status}"`);
  }
  return resolved;
}

/** A submission type from a path or query; undefined passes through (all types). */
export function parseReviewableType(type: string | undefined): ReviewableType | undefined {
  if (type === undefined) return undefined;
  if (!REVIEWABLE_TYPES.includes(type as ReviewableType)) {
    throw new BadRequestException(`Invalid submission type "${type}"`);
  }
  return type as ReviewableType;
}

/** The queue's `?source=` (default 'all', what /v1 has always listed). */
export function parseSubmissionSource(source: string | undefined): SubmissionSource {
  const resolved = (source ?? 'all') as SubmissionSource;
  if (!SUBMISSION_SOURCES.includes(resolved)) {
    throw new BadRequestException(`Invalid source "${source}"`);
  }
  return resolved;
}

/** The queue's `?q=` name search: trimmed, ignored under the minimum, 400 over the maximum. */
export function parseSubmissionSearch(q: string | undefined): string | undefined {
  const trimmed = q?.trim();
  if (!trimmed || trimmed.length < SUBMISSION_QUERY_MIN) return undefined;
  if (trimmed.length > SUBMISSION_QUERY_MAX) {
    throw new BadRequestException(`Search is longer than ${SUBMISSION_QUERY_MAX} characters`);
  }
  return trimmed;
}
