import { IsEmail, IsString, MinLength } from 'class-validator';
import type { UpdateProfileInput } from '@repo/api';

export class UpdateProfileDto implements UpdateProfileInput {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;
}
