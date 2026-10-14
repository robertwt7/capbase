import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  COMPANY_SORTS,
  COMPANY_STATUSES,
  COUNTRY_CODES,
  MAX_FEATURED_LIMIT,
  MAX_PAGE_SIZE,
  SECTORS,
  STAGES,
  type CompanyListQuery,
  type CompanySort,
  type CompanyStatus,
  type CountryCode,
  type Sector,
  type Stage,
} from '@repo/api';

export class ListCompaniesDto implements CompanyListQuery {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn([...SECTORS])
  sector?: Sector;

  @IsOptional()
  @IsIn([...STAGES])
  stage?: Stage;

  @IsOptional()
  @IsIn([...COMPANY_STATUSES])
  status?: CompanyStatus;

  /** ISO alpha-2, upper-case — an unassigned code is a 400, not an empty page. */
  @IsOptional()
  @IsIn([...COUNTRY_CODES])
  country?: CountryCode;

  @IsOptional()
  @IsIn([...COMPANY_SORTS])
  sort?: CompanySort;

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

  /** Comma-separated slug list — fetches exactly those companies (compare page). */
  @IsOptional()
  @IsString()
  slugs?: string;
}

export class FeaturedCompaniesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_FEATURED_LIMIT)
  limit?: number;
}
