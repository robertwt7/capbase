import { IsString, MaxLength, MinLength } from 'class-validator';
import type { ResetPasswordInput } from '@repo/api';

export class ResetPasswordDto implements ResetPasswordInput {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
