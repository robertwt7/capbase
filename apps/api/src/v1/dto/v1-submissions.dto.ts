import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { REVIEWABLE_TYPES, type ReviewableType, type ReviewStatus } from '@repo/api';

export class V1ListSubmissionsDto {
  /** Defaults to PENDING. */
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: ReviewStatus;

  /** One submission type; all types when absent. */
  @IsOptional()
  @IsIn([...REVIEWABLE_TYPES])
  type?: ReviewableType;

  /** The previous page's `nextCursor`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;
}
