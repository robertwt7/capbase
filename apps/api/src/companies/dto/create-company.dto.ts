import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
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
  type CompanyFinancials,
  type CompanyStatus,
  type CompanyType,
  type CreateCompanyInput,
  type OperatingStatus,
  type Sector,
  type Stage,
} from '@repo/api';

class FinancialsDto implements CompanyFinancials {
  @IsInt()
  @Min(0)
  revenueUsd!: number;

  @IsInt()
  revenueGrowthPct!: number;

  @IsInt()
  grossMarginPct!: number;

  @IsOptional()
  @IsInt()
  burnMonths!: number | null;
}

export class CreateCompanyDto implements CreateCompanyInput {
  @IsString()
  @MaxLength(300)
  @MinLength(1)
  name!: string;

  @IsString()
  @MaxLength(300)
  @MinLength(1)
  domain!: string;

  @IsString()
  @MaxLength(300)
  @MinLength(1)
  oneLiner!: string;

  @IsString()
  @MaxLength(10000)
  @MinLength(1)
  description!: string;

  @IsString()
  @MaxLength(300)
  @MinLength(1)
  hq!: string;

  @IsInt()
  founded!: number;

  @IsInt()
  @Min(0)
  headcount!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  industry!: string[];

  @IsIn([...COMPANY_STATUSES])
  status!: CompanyStatus;

  @IsIn([...STAGES])
  stage!: Stage;

  @IsInt()
  @Min(0)
  totalRaisedUsd!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lastValuationUsd?: number | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => FinancialsDto)
  financials?: CompanyFinancials;

  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  websiteUrl?: string | null;

  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  linkedinUrl?: string | null;

  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  twitterUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
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

  /** Primary document backing this contribution. Optional, but prompted: an
      uncited fact renders as explicitly uncited rather than looking sourced. */
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  sourceUrl?: string | null;
}
