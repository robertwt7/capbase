import { IsIn, IsString, MinLength } from 'class-validator';
import { IDENTIFIABLE_TYPES, type IdentifiableType, type MergeDecisionInput } from '@repo/api';

export class MergeDecisionDto implements MergeDecisionInput {
  /** Which of the pair survives. Validated against the candidate server-side. */
  @IsString()
  @MinLength(1)
  survivorId!: string;
}

/** Queue a pair the detector missed. Same-type only: a company and an investor
 *  row sharing a CIK are one organisation with two roles, not a duplicate. */
export class ManualMergeCandidateDto {
  @IsIn([...IDENTIFIABLE_TYPES])
  entityType!: IdentifiableType;

  @IsString()
  @MinLength(1)
  leftId!: string;

  @IsString()
  @MinLength(1)
  rightId!: string;
}
