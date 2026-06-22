import { IsEmail, IsString, MinLength } from 'class-validator';
import type { RegisterInput } from '@repo/api';

export class RegisterDto implements RegisterInput {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
