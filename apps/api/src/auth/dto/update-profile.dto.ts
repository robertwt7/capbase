import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { UpdateProfileInput } from '@repo/api';

export class UpdateProfileDto implements UpdateProfileInput {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;
}
