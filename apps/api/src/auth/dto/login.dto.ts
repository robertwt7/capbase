import { IsEmail, IsString, MaxLength } from 'class-validator';
import type { LoginInput } from '@repo/api';

export class LoginDto implements LoginInput {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // Capped so an oversized body can't make bcrypt burn CPU.
  @IsString()
  @MaxLength(128)
  password!: string;
}
