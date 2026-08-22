import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  COMPANY_STATUSES,
  COMPANY_TYPES,
  OPERATING_STATUSES,
  SECTORS,
  STAGES,
  type CompanyEditFields,
  type CompanyStatus,
  type CompanyType,
  type CreateChangeProposalInput,
  type OperatingStatus,
  type Sector,
  type Stage,
} from '@repo/api';

// The editable-field whitelist: every field optional, validated exactly like its
// CreateCompanyDto counterpart. The global `whitelist: true` ValidationPipe strips
// unknown keys, so only these fields can ever reach the stored `changes` JSON.
export class CompanyEditFieldsDto implements CompanyEditFields {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  domain?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  oneLiner?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  hq?: string;

  @IsOptional()
  @IsInt()
  founded?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  headcount?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  industry?: string[];

  @IsOptional()
  @IsIn([...COMPANY_STATUSES])
  status?: CompanyStatus;

  @IsOptional()
  @IsIn([...STAGES])
  stage?: Stage;

  @IsOptional()
  @IsInt()
  @Min(0)
  totalRaisedUsd?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lastValuationUsd?: number | null;

  @IsOptional()
  @IsUrl()
  websiteUrl?: string | null;

  @IsOptional()
  @IsUrl()
  linkedinUrl?: string | null;

  @IsOptional()
  @IsUrl()
  twitterUrl?: string | null;

  @IsOptional()
  @IsString()
  legalName?: string | null;

  @IsOptional()
  @IsIn([...OPERATING_STATUSES])
  operatingStatus?: OperatingStatus | null;

  @IsOptional()
  @IsIn([...COMPANY_TYPES])
  companyType?: CompanyType | null;

  @IsOptional()
  @IsIn([...SECTORS])
  primarySector?: Sector | null;
}

export class CreateChangeProposalDto implements CreateChangeProposalInput {
  @ValidateNested()
  @Type(() => CompanyEditFieldsDto)
  changes!: CompanyEditFieldsDto;

  @IsOptional()
  @IsString()
  note?: string | null;

  /** Sits on the proposal, NOT on CompanyEditFieldsDto: that class is the
      editable-column whitelist and the ValidationPipe strips anything else, so
      adding a key there would make it look editable. */
  @IsOptional()
  @IsUrl()
  sourceUrl?: string | null;
}
