import { IsString, MaxLength, MinLength } from 'class-validator';
import type { ChangePasswordInput } from '@repo/api';

export class ChangePasswordDto implements ChangePasswordInput {
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
