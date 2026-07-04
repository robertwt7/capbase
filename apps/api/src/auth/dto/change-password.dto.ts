import { IsString, MinLength } from 'class-validator';
import type { ChangePasswordInput } from '@repo/api';

export class ChangePasswordDto implements ChangePasswordInput {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
