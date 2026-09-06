import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  MAX_PAGE_SIZE,
  PERSON_SORTS,
  type PersonListQuery,
  type PersonSort,
} from '@repo/api';

export class ListPeopleDto implements PersonListQuery {
  @IsOptional()
  @IsString()
  q?: string;

  // Query params arrive as strings; anything but 'true' is false, so a stray
  // value cannot silently widen the result set.
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  multiCompany?: boolean;

  @IsOptional()
  @IsIn([...PERSON_SORTS])
  sort?: PersonSort;

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
