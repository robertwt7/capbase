import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  COMPANY_SORTS,
  COMPANY_STATUSES,
  COUNTRY_CODES,
  INVESTOR_LINKS,
  MAX_FEATURED_LIMIT,
  MAX_PAGE_SIZE,
  ROUND_KINDS,
  ROUND_WINDOWS,
  SCREEN_FOUNDED_MAX,
  SCREEN_FOUNDED_MIN,
  SCREEN_HEADCOUNT_MAX,
  SCREEN_INVESTOR_MAX,
  SCREEN_MONEY_MAX,
  SECTORS,
  STAGES,
  type CompanyListQuery,
  type CompanySort,
  type CompanyStatus,
  type CountryCode,
  type InvestorLink,
  type RoundKind,
  type RoundWindow,
  type Sector,
  type Stage,
} from '@repo/api';

/** `YYYY-MM-DD`; the service also rejects an unreal date such as 2026-02-30. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

  /** Recorded total raised of at least this many USD. Companies with no recorded total never match (not even `raisedMin=0`). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(SCREEN_MONEY_MAX)
  raisedMin?: number;

  /** Recorded total raised of at most this many USD. Companies with no recorded total never match. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(SCREEN_MONEY_MAX)
  raisedMax?: number;

  /** Recorded last valuation of at least this many USD. Companies with no recorded valuation never match. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(SCREEN_MONEY_MAX)
  valuationMin?: number;

  /** Recorded last valuation of at most this many USD. Companies with no recorded valuation never match. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(SCREEN_MONEY_MAX)
  valuationMax?: number;

  /** Founded in or after this year. Companies with no recorded founding year never match. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(SCREEN_FOUNDED_MIN)
  @Max(SCREEN_FOUNDED_MAX)
  foundedMin?: number;

  /** Founded in or before this year. Companies with no recorded founding year never match. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(SCREEN_FOUNDED_MIN)
  @Max(SCREEN_FOUNDED_MAX)
  foundedMax?: number;

  /** Recorded headcount of at least this many. Companies with no recorded headcount never match. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(SCREEN_HEADCOUNT_MAX)
  headcountMin?: number;

  /** Recorded headcount of at most this many. Companies with no recorded headcount never match. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(SCREEN_HEADCOUNT_MAX)
  headcountMax?: number;

  /** Had a matching financing within the last N months (`3m`…`36m`), resolved when the request
   *  runs; future-dated rounds never match. Not combinable with `roundFrom`/`roundTo`. Every
   *  financing criterion must hold for the same approved round. */
  @IsOptional()
  @IsIn([...ROUND_WINDOWS])
  roundWithin?: RoundWindow;

  /** Earliest financing date, inclusive (`YYYY-MM-DD`). */
  @IsOptional()
  @Matches(ISO_DATE)
  roundFrom?: string;

  /** Latest financing date, inclusive (`YYYY-MM-DD`). */
  @IsOptional()
  @Matches(ISO_DATE)
  roundTo?: string;

  /** The matching financing's kind: `Equity`, `Debt` or `Grant`. */
  @IsOptional()
  @IsIn([...ROUND_KINDS])
  roundKind?: RoundKind;

  /** The matching financing raised at least this many USD. Undisclosed amounts never match a size. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(SCREEN_MONEY_MAX)
  roundMin?: number;

  /** The matching financing raised at most this many USD. Undisclosed amounts never match a size. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(SCREEN_MONEY_MAX)
  roundMax?: number;

  /** Investor slug. A merged slug resolves to the surviving firm; an unknown one matches nothing. */
  @IsOptional()
  @IsString()
  @MaxLength(SCREEN_INVESTOR_MAX)
  investor?: string;

  /** `any` (default): a recorded holding or a name on an approved round. `round`: named on the
   *  matching financing. Needs `investor`. */
  @IsOptional()
  @IsIn([...INVESTOR_LINKS])
  investorOn?: InvestorLink;
}

export class FeaturedCompaniesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_FEATURED_LIMIT)
  limit?: number;
}
