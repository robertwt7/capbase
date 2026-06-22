import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  COMPANY_STATUSES,
  STAGES,
  type CompanyFinancials,
  type CompanyStatus,
  type CreateCompanyInput,
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
}
