import { IsIn } from 'class-validator';
import type { ModerationDecisionInput } from '@repo/api';

export class ModerationDecisionDto implements ModerationDecisionInput {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';
}
