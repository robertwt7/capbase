import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  MAX_PAGE_SIZE,
  ROLES,
  type AdminUserListQuery,
  type Role,
  type UpdateUserInput,
} from '@repo/api';

export class ListUsersDto implements AdminUserListQuery {
  @IsOptional()
  @IsString()
  @MaxLength(254)
  q?: string;

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

export class UpdateUserDto implements UpdateUserInput {
  @IsOptional()
  @IsBoolean()
  banned?: boolean;

  @IsOptional()
  @IsIn([...ROLES])
  role?: Role;
}
