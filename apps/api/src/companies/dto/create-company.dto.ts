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
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  domain!: string;

  @IsString()
  @MinLength(1)
  oneLiner!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsString()
  @MinLength(1)
  hq!: string;

  @IsInt()
  founded!: number;

  @IsInt()
  @Min(0)
  headcount!: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
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
