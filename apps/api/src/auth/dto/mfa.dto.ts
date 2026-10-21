import { Transform } from 'class-transformer';
import { IsIn, IsObject, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import {
  MFA_METHODS,
  PASSKEY_NAME_MAX,
  type ChallengeInput,
  type MfaMethod,
  type MfaVerifyInput,
  type PasskeyLoginInput,
  type PasskeyRegisterInput,
  type PasswordConfirmInput,
  type SetupPasskeyInput,
  type SetupTotpConfirmInput,
  type TotpConfirmInput,
} from '@repo/api';

/** A challenge token is 32 random bytes, base64url: always 43 characters. */
const CHALLENGE_LENGTH = 43;
const SIX_DIGITS = /^[0-9]{6}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ChallengeDto implements ChallengeInput {
  @IsString()
  @Length(CHALLENGE_LENGTH, CHALLENGE_LENGTH)
  challenge!: string;
}

/** POST /auth/login/mfa. `code`'s format depends on `method`, so the service checks it. */
export class MfaVerifyDto extends ChallengeDto implements MfaVerifyInput {
  @IsIn(MFA_METHODS)
  method!: MfaMethod;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @IsOptional()
  @IsObject()
  response?: Record<string, unknown>;
}

export class PasswordConfirmDto implements PasswordConfirmInput {
  // Capped so an oversized body can't make bcrypt burn CPU.
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class TotpConfirmDto extends ChallengeDto implements TotpConfirmInput {
  @IsString()
  @Matches(SIX_DIGITS, { message: 'Enter the 6-digit code' })
  code!: string;
}

export class SetupTotpConfirmDto extends TotpConfirmDto implements SetupTotpConfirmInput {
  @IsString()
  @Length(CHALLENGE_LENGTH, CHALLENGE_LENGTH)
  totpChallenge!: string;
}

export class PasskeyRegisterDto extends ChallengeDto implements PasskeyRegisterInput {
  @IsObject()
  response!: Record<string, unknown>;

  @Transform(trim)
  @IsString()
  @Length(1, PASSKEY_NAME_MAX)
  name!: string;
}

export class SetupPasskeyDto extends PasskeyRegisterDto implements SetupPasskeyInput {
  @IsString()
  @Length(CHALLENGE_LENGTH, CHALLENGE_LENGTH)
  registerChallenge!: string;
}

export class PasskeyLoginDto extends ChallengeDto implements PasskeyLoginInput {
  @IsObject()
  response!: Record<string, unknown>;
}
