import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  INVESTOR_SORTS,
  INVESTOR_TYPES,
  MAX_PAGE_SIZE,
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
