import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  API_KEY_NAME_MAX,
  API_KEY_SCOPES,
  MAX_API_KEY_CIDRS,
  type ApiKeyScope,
  type CreateApiKeyInput,
} from '@repo/api';

export class CreateApiKeyDto implements CreateApiKeyInput {
  /** A label for the owner's own list, e.g. "Data team laptop". */
  @IsString()
  @MinLength(1)
  @MaxLength(API_KEY_NAME_MAX)
  name!: string;

  /** `contributor` (writes land PENDING) or `admin` (published at once; admins only). */
  @IsIn([...API_KEY_SCOPES])
  scope!: ApiKeyScope;

  /** Addresses or CIDR ranges the key may be used from. Empty or absent: any address. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_API_KEY_CIDRS)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  allowedCidrs?: string[];
}
