import { IsString, MaxLength, MinLength } from 'class-validator';
import type { VerifyEmailInput } from '@repo/api';

export class VerifyEmailDto implements VerifyEmailInput {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;
}
