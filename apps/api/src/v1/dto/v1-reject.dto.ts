import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MODERATION_NOTE_MAX } from '@repo/api';

export class V1RejectDto {
  /** Optional reason, quoted in the email to the contributor. Not stored. */
  @IsOptional()
  @IsString()
  @MaxLength(MODERATION_NOTE_MAX)
  note?: string | null;
}
