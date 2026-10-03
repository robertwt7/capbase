import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  REPORT_MESSAGE_MAX,
  REPORT_MESSAGE_MIN,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORTABLE_TYPES,
  type CreateReportInput,
  type DismissReportInput,
  type ReportableType,
  type ReportReason,
  type ReportStatus,
  type ResolveReportInput,
} from '@repo/api';

/** Anonymous "Report an issue" submission. */
export class CreateReportDto implements CreateReportInput {
  @IsIn([...REPORTABLE_TYPES])
  entityType!: ReportableType;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  slug!: string;

  @IsIn([...REPORT_REASONS])
  reason!: ReportReason;

  @IsString()
  @MinLength(REPORT_MESSAGE_MIN)
  @MaxLength(REPORT_MESSAGE_MAX)
  message!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

export class ListReportsDto {
  @IsOptional()
  @IsIn([...REPORT_STATUSES])
  status?: ReportStatus;
}

export class ResolveReportDto implements ResolveReportInput {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsBoolean()
  suppressPerson?: boolean;
}

export class DismissReportDto implements DismissReportInput {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
