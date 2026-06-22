import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
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
  @MinLength(1)
  name!: string;

  @IsBoolean()
  lead!: boolean;
}

export class CreateFundingRoundDto implements CreateFundingRoundInput {
  @IsString()
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
  lead?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoundInvestorDto)
  investors!: RoundInvestorDto[];
}

export class CreatePersonDto implements CreatePersonInput {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  role!: string;

  @IsInt()
  since!: number;

  @IsOptional()
  @IsString()
  prior?: string;
}

export class CreateInvestorDto implements CreateInvestorInput {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn([...INVESTOR_TYPES])
  type!: InvestorType;

  @IsString()
  @MinLength(1)
  firstRound!: string;

  @IsInt()
  @Min(0)
  rounds!: number;
}

export class CreateAcquisitionDto implements CreateAcquisitionInput {
  @IsString()
  @MinLength(1)
  target!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountUsd?: number | null;

  @IsString()
  @MinLength(1)
  rationale!: string;
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
  @MinLength(1)
  detail!: string;
}

export class CreateDiversityDto implements CreateDiversityInput {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsString()
  @MinLength(1)
  value!: string;

  @IsString()
  @MinLength(1)
  note!: string;
}
