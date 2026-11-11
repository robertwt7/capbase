import {
  Equals,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ADMIN_CLAIM_STATUS_FILTERS,
  CLAIM_EVIDENCE_URL_MAX,
  CLAIM_NOTE_MAX,
  CLAIM_NOTE_MIN,
  MODERATION_NOTE_MAX,
  type AdminClaimStatusFilter,
  type ClaimDecisionInput,
  type ClaimRequestInput,
  type StartEmailClaimInput,
  type VerifyClaimInput,
} from '@repo/api';

// Every property carries a validator: the global pipe strips undecorated ones.

const AUTHORISED = { message: 'Confirm you are authorised to represent this company' };

export class StartEmailClaimDto implements StartEmailClaimInput {
  @IsEmail({}, { message: 'Enter a valid work email address' })
  @MaxLength(254)
  email!: string;

  @Equals(true, AUTHORISED)
  authorised!: boolean;
}

export class VerifyClaimDto implements VerifyClaimInput {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;
}

export class ClaimRequestDto implements ClaimRequestInput {
  @IsString()
  @MinLength(CLAIM_NOTE_MIN, {
    message: `Tell us how you're connected to the company (at least ${CLAIM_NOTE_MIN} characters)`,
  })
  @MaxLength(CLAIM_NOTE_MAX)
  note!: string;

  @IsOptional()
  @IsUrl({}, { message: 'Enter a full link, starting with https://' })
  @MaxLength(CLAIM_EVIDENCE_URL_MAX)
  evidenceUrl?: string;

  @Equals(true, AUTHORISED)
  authorised!: boolean;
}

export class ClaimDecisionDto implements ClaimDecisionInput {
  @IsOptional()
  @IsString()
  @MaxLength(MODERATION_NOTE_MAX)
  note?: string;
}

export class ListAdminClaimsDto {
  @IsOptional()
  @IsIn([...ADMIN_CLAIM_STATUS_FILTERS])
  status?: AdminClaimStatusFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
