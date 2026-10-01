import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { RegisterInput } from '@repo/api';

export class RegisterDto implements RegisterInput {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
