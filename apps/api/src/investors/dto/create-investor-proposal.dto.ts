import { Type } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  COUNTRY_CODES,
  INVESTOR_TYPES,
  type CountryCode,
  type CreateInvestorProposalInput,
  type InvestorEditFields,
  type InvestorType,
} from '@repo/api';

// The editable investor-firm whitelist: every field optional (null clears it). The global
// `whitelist: true` ValidationPipe strips unknown keys, so the ingest-owned ADV facts
// (CRD/CIK/fund count/assets) can never reach the stored `changes` JSON.
export class InvestorEditFieldsDto implements InvestorEditFields {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  legalName?: string | null;

  @IsOptional()
  @IsIn([...INVESTOR_TYPES])
  type?: InvestorType;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  hq?: string | null;

  /** ISO 3166-1 alpha-2, upper-case. */
  @IsOptional()
  @IsIn([...COUNTRY_CODES])
  countryCode?: CountryCode | null;

  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  websiteUrl?: string | null;

  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  linkedinUrl?: string | null;

  /** The firm's own host (`sequoiacap.com`). A match key for ingest, so never a social or
   *  platform host. */
  @IsOptional()
  @IsString()
  @MaxLength(253)
  domain?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1600)
  @Max(2100)
  foundedYear?: number | null;
}

export class CreateInvestorProposalDto implements CreateInvestorProposalInput {
  @ValidateNested()
  @Type(() => InvestorEditFieldsDto)
  changes!: InvestorEditFieldsDto;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  note?: string | null;

  /** Primary document backing the edit. Stored on the proposal for the moderator. */
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  sourceUrl?: string | null;

  /** Contribution attestation (Terms §4). Required — and decorated, because the
   *  global ValidationPipe silently strips undecorated fields. */
  @Equals(true, {
    message: 'You must confirm you have the right to share this contribution',
  })
  attested!: boolean;
}
