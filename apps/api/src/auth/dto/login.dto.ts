import { IsEmail, IsString } from 'class-validator';
import type { LoginInput } from '@repo/api';

export class LoginDto implements LoginInput {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}
