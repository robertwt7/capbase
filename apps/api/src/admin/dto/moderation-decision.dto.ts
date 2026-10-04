import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { MODERATION_NOTE_MAX, type ModerationDecisionInput } from '@repo/api';

export class ModerationDecisionDto implements ModerationDecisionInput {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(MODERATION_NOTE_MAX)
  note?: string | null;
}
