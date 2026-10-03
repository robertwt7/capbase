import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  EXIT_TYPES,
  INVESTOR_TYPES,
  type CreateAcquisitionInput,
  type CreateDiversityInput,
  type CreateExitInput,
  type CreateFundingRoundInput,
  type CreateInvestorInput,
  type CreatePersonInput,
  type ExitType,
  type InvestorType,
  type RoundInvestor,
} from '@repo/api';

class RoundInvestorDto implements RoundInvestor {
  @IsString()
  @MaxLength(300)
  @MinLength(1)
  name!: string;

  @IsBoolean()
  lead!: boolean;
}

export class CreateFundingRoundDto implements CreateFundingRoundInput {
  @IsString()
  @MaxLength(300)
  @MinLength(1)
  name!: string;

  @IsDateString()
  date!: string;

  @IsInt()
  @Min(0)
  amountUsd!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  postMoneyUsd?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  lead?: string | null;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RoundInvestorDto)
  investors!: RoundInvestorDto[];

  /** Primary document backing this contribution. Optional, but prompted: an
      uncited fact renders as explicitly uncited rather than looking sourced. */
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  sourceUrl?: string | null;

  /** Contribution attestation (Terms §4). Required — and decorated, because the
   *  global ValidationPipe silently strips undecorated fields. */
  @Equals(true, { message: 'You must confirm you have the right to share this contribution' })
  attested!: boolean;
}

export class CreatePersonDto implements CreatePersonInput {
  @IsString()
  @MaxLength(300)
  @MinLength(1)
  name!: string;

  @IsString()
  @MaxLength(300)
  @MinLength(1)
  role!: string;

  @IsInt()
  since!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  prior?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  linkedinUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string | null;

  /** Primary document backing this contribution. Optional, but prompted: an
      uncited fact renders as explicitly uncited rather than looking sourced. */
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  sourceUrl?: string | null;

  /** Contribution attestation (Terms §4). Required — and decorated, because the
   *  global ValidationPipe silently strips undecorated fields. */
  @Equals(true, { message: 'You must confirm you have the right to share this contribution' })
  attested!: boolean;
}

export class CreateInvestorDto implements CreateInvestorInput {
  @IsString()
  @MaxLength(300)
  @MinLength(1)
  name!: string;

  @IsIn([...INVESTOR_TYPES])
  type!: InvestorType;

  @IsString()
  @MaxLength(300)
  @MinLength(1)
  firstRound!: string;

  @IsInt()
  @Min(0)
  rounds!: number;

  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  websiteUrl?: string | null;

  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  linkedinUrl?: string | null;

  /** Primary document backing this contribution. Optional, but prompted: an
      uncited fact renders as explicitly uncited rather than looking sourced. */
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  sourceUrl?: string | null;

  /** Contribution attestation (Terms §4). Required — and decorated, because the
   *  global ValidationPipe silently strips undecorated fields. */
  @Equals(true, { message: 'You must confirm you have the right to share this contribution' })
  attested!: boolean;
}

export class CreateAcquisitionDto implements CreateAcquisitionInput {
  @IsString()
  @MaxLength(300)
  @MinLength(1)
  target!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountUsd?: number | null;

  @IsString()
  @MaxLength(10000)
  @MinLength(1)
  rationale!: string;

  /** Primary document backing this contribution. Optional, but prompted: an
      uncited fact renders as explicitly uncited rather than looking sourced. */
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  sourceUrl?: string | null;

  /** Contribution attestation (Terms §4). Required — and decorated, because the
   *  global ValidationPipe silently strips undecorated fields. */
  @Equals(true, { message: 'You must confirm you have the right to share this contribution' })
  attested!: boolean;
}

export class CreateExitDto implements CreateExitInput {
  @IsIn([...EXIT_TYPES])
  type!: ExitType;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  valueUsd?: number | null;

  @IsString()
  @MaxLength(10000)
  @MinLength(1)
  detail!: string;

  /** Primary document backing this contribution. Optional, but prompted: an
      uncited fact renders as explicitly uncited rather than looking sourced. */
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  sourceUrl?: string | null;

  /** Contribution attestation (Terms §4). Required — and decorated, because the
   *  global ValidationPipe silently strips undecorated fields. */
  @Equals(true, { message: 'You must confirm you have the right to share this contribution' })
  attested!: boolean;
}

export class CreateDiversityDto implements CreateDiversityInput {
  @IsString()
  @MaxLength(300)
  @MinLength(1)
  label!: string;

  @IsString()
  @MaxLength(300)
  @MinLength(1)
  value!: string;

  @IsString()
  @MaxLength(10000)
  @MinLength(1)
  note!: string;

  /** Primary document backing this contribution. Optional, but prompted: an
      uncited fact renders as explicitly uncited rather than looking sourced. */
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  sourceUrl?: string | null;

  /** Contribution attestation (Terms §4). Required — and decorated, because the
   *  global ValidationPipe silently strips undecorated fields. */
  @Equals(true, { message: 'You must confirm you have the right to share this contribution' })
  attested!: boolean;
}
