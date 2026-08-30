import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  FUND_SORTS,
  FUND_STRATEGIES,
  MAX_PAGE_SIZE,
  type FundListQuery,
  type FundSort,
  type FundStrategy,
} from '@repo/api';

export class ListFundsDto implements FundListQuery {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn([...FUND_STRATEGIES])
  strategy?: FundStrategy;

  /** Investor slug — the investor profile's "all N funds" link. */
  @IsOptional()
  @IsString()
  manager?: string;

  @IsOptional()
  @IsIn([...FUND_SORTS])
  sort?: FundSort;

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
