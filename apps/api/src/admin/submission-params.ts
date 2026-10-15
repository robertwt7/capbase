import { BadRequestException } from '@nestjs/common';
import { REVIEWABLE_TYPES, type ReviewableType, type ReviewStatus } from '@repo/api';

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
