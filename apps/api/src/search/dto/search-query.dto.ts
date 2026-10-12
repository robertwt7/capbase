import { IsString, MaxLength } from 'class-validator';
import { SEARCH_MAX_CHARS } from '@repo/api';

export class SearchQueryDto {
  // Required: an undecorated property would be stripped by the whitelist pipe.
  @IsString()
  @MaxLength(SEARCH_MAX_CHARS)
  q!: string;
}
