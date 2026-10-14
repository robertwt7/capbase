import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  COUNTRY_CODES,
  INVESTOR_SORTS,
  INVESTOR_TYPES,
  MAX_PAGE_SIZE,
  type CountryCode,
  type InvestorListQuery,
  type InvestorSort,
  type InvestorType,
} from '@repo/api';

export class ListInvestorsDto implements InvestorListQuery {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn([...INVESTOR_TYPES])
  type?: InvestorType;

  /** ISO alpha-2, upper-case — an unassigned code is a 400, not an empty page. */
  @IsOptional()
  @IsIn([...COUNTRY_CODES])
  country?: CountryCode;

  @IsOptional()
  @IsIn([...INVESTOR_SORTS])
  sort?: InvestorSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}
