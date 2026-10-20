// Shared domain types for Capbase. These are the single source of truth for the
// shapes exchanged between the NestJS API (apps/api) and the Next.js web app
// (apps/web). Keep them runtime-dependency-free — plain TypeScript only.

import type { EntityIdentifierRef } from './identifiers';

export type Stage =
  | 'Bootstrapped' // no outside funding; human-written only — no source can state it
  | 'Seed'
  | 'Series A'
  | 'Series B'
  | 'Series C'
  | 'Series D'
  | 'Series E'
  | 'Series F'
  | 'Late stage'
  | 'Public'
  | 'Acquired';

export const STAGES: readonly Stage[] = [
  'Bootstrapped',
  'Seed',
  'Series A',
  'Series B',
  'Series C',
  'Series D',
  'Series E',
  'Series F',
  'Late stage',
  'Public',
  'Acquired',
];

export type CompanyStatus = 'Private' | 'Public' | 'Acquired';

export const COMPANY_STATUSES: readonly CompanyStatus[] = ['Private', 'Public', 'Acquired'];

/** Controlled sector vocabulary, shared between Company.primarySector and MarketStat.sector. */
export type Sector =
  | 'Artificial intelligence'
  | 'Fintech'
  | 'Healthcare'
  | 'Climate'
  | 'Enterprise SaaS'
  | 'Technology' // generic tech (SEC "Other Technology"/"Computers")
  | 'Financial services' // banking, insurance, investing
  | 'Energy' // oil & gas, non-renewable energy
  | 'Real estate'
  | 'Industrials' // manufacturing, agriculture, construction inputs
  | 'Consumer & retail' // retail, restaurants, hospitality, travel
  | 'Transport'
  | 'Media & telecom'
  | 'Education';

export const SECTORS: readonly Sector[] = [
  'Artificial intelligence',
  'Fintech',
  'Healthcare',
  'Climate',
  'Enterprise SaaS',
  'Technology',
  'Financial services',
  'Energy',
  'Real estate',
  'Industrials',
  'Consumer & retail',
  'Transport',
  'Media & telecom',
  'Education',
];

export type OperatingStatus = 'Active' | 'Closed';

export const OPERATING_STATUSES: readonly OperatingStatus[] = ['Active', 'Closed'];

export type CompanyType = 'For profit' | 'Non-profit';

export const COMPANY_TYPES: readonly CompanyType[] = ['For profit', 'Non-profit'];

/** Controlled investor vocabulary. Every value is read from a publisher's
 *  structured field, never guessed from the firm's name: `Hedge fund`,
 *  `Sovereign wealth` and `Private equity` come from Wikidata P31 classes and the
 *  Form ADV fund-type columns; the limited-partner types (`Pension fund` through
 *  `Government`) come from a data partner's closed firm-type field. */
export type InvestorType =
  | 'Venture'
  | 'Growth'
  | 'Angel'
  | 'Corporate'
  | 'Private equity'
  | 'Accelerator'
  | 'Hedge fund'
  | 'Sovereign wealth'
  | 'Pension fund'
  | 'Endowment'
  | 'Foundation'
  | 'Family office'
  | 'Insurance'
  | 'Bank'
  | 'Wealth manager'
  | 'Asset manager'
  | 'Fund of funds'
  | 'Government';

export const INVESTOR_TYPES: readonly InvestorType[] = [
  'Venture',
  'Growth',
  'Angel',
  'Corporate',
  'Private equity',
  'Accelerator',
  'Hedge fund',
  'Sovereign wealth',
  'Pension fund',
  'Endowment',
  'Foundation',
  'Family office',
  'Insurance',
  'Bank',
  'Wealth manager',
  'Asset manager',
  'Fund of funds',
  'Government',
];

/** What kind of capital a fund deploys. Both SEC sources publish a fund type as
 *  a structured field, so this is read, never guessed:
 *    Form ADV Schedule D 7.B.(1) `Fund Type` — Hedge Fund | Private Equity Fund |
 *      Venture Capital Fund | Real Estate Fund | Securitized Asset Fund |
 *      Liquidity Fund | Other Private Fund
 *    Form D `investmentFundType` — Hedge Fund | Private Equity Fund |
 *      Venture Capital Fund | Other Investment Fund
 */
export type FundStrategy =
  | 'Venture capital'
  | 'Private equity'
  | 'Hedge fund'
  | 'Real estate'
  | 'Securitized asset'
  | 'Liquidity'
  | 'Other';

export const FUND_STRATEGIES: readonly FundStrategy[] = [
  'Venture capital',
  'Private equity',
  'Hedge fund',
  'Real estate',
  'Securitized asset',
  'Liquidity',
  'Other',
];

/** Where a fund is in its life. Read from a data partner's closed fund-status
 *  field; the SEC sources publish none, so their funds leave it null. */
export type FundStatus =
  | 'Announced'
  | 'Raising'
  | 'First close'
  | 'Second close'
  | 'Later close'
  | 'Closed'
  | 'Evergreen'
  | 'Liquidated';

export const FUND_STATUSES: readonly FundStatus[] = [
  'Announced',
  'Raising',
  'First close',
  'Second close',
  'Later close',
  'Closed',
  'Evergreen',
  'Liquidated',
];

/** Capital type of a funding round. Grants are non-dilutive government awards
 *  (SBIR/STTR); they are capital events, not raises, so money aggregates skip
 *  them. Debt covers Reg CF debt offerings. */
export type RoundKind = 'Equity' | 'Debt' | 'Grant';

export const ROUND_KINDS: readonly RoundKind[] = ['Equity', 'Debt', 'Grant'];

export type ExitType = 'IPO' | 'Acquisition' | 'Secondary';

export const EXIT_TYPES: readonly ExitType[] = ['IPO', 'Acquisition', 'Secondary'];

/** Moderation state of a crowdsourced row. Public reads only return APPROVED. */
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface RoundInvestor {
  name: string;
  lead: boolean;
}

export interface FundingRound {
  /** Row identity — what a Citation or Revision anchors to. */
  id: string;
  /** Round label, e.g. "Series B". Rounds are an ordered sequence. */
  name: string;
  date: string; // ISO date the round was announced
  /** Capital in this round, in USD — FX-converted at the round's date when it
   *  was published in another currency. The comparable figure: every sort,
   *  total and bar width reads this. */
  amountUsd: number;
  /** ISO 4217 of the amount as published ('USD' for most rows). */
  currency?: string;
  /** The published amount in `currency`; null when that is USD. */
  amountLocal?: number | null;
  /** Equity unless the source says otherwise. */
  kind: RoundKind;
  postMoneyUsd: number | null; // post-money valuation, when disclosed
  lead: string | null;
  investors: RoundInvestor[];
  /** Fields withheld from this viewer (see `Company.masked`). */
  masked?: string[];
}

/**
 * One person as a company profile sees them — the `PersonRole` row, under the
 * name a `Citation` anchors to. The deduplicated human behind it is
 * `PersonSummary` in `person.ts`, reachable through `personSlug`.
 */
export interface Person {
  /** Row identity — what a Citation or Revision anchors to. */
  id: string;
  /** Slug of the linked person profile; null when the role has not been
   *  resolved to a person, or the person is suppressed. */
  personSlug?: string | null;
  name: string;
  role: string;
  since: number; // year joined
  prior?: string; // notable prior affiliation
  linkedinUrl?: string | null;
  title?: string | null;
}

export interface InvestorHolding {
  /** Row identity — what a Citation or Revision anchors to. */
  id: string;
  /** Slug of the linked Investor profile; null when the firm is not yet approved. */
  slug?: string | null;
  name: string;
  type: InvestorType;
  firstRound: string;
  rounds: number; // how many rounds they participated in
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
}

export interface AcquisitionDeal {
  /** Row identity — what a Citation or Revision anchors to. */
  id: string;
  /** The company Capbase's subject acquired. */
  target: string;
  date: string;
  amountUsd: number | null;
  rationale: string;
}

export interface ExitEvent {
  /** Row identity — what a Citation or Revision anchors to. */
  id: string;
  type: ExitType;
  date: string;
  valueUsd: number | null;
  detail: string;
}

export interface DiversitySignal {
  /** Row identity — what a Citation or Revision anchors to. */
  id: string;
  label: string;
  value: string;
  note: string;
}

export interface CompanyFinancials {
  revenueUsd: number;
  revenueGrowthPct: number;
  grossMarginPct: number;
  burnMonths: number | null;
}

/** Lightweight listing entry for the web sitemap: every APPROVED company. */
export interface CompanySlugEntry {
  slug: string;
  updatedAt: string; // ISO timestamp of the row's last update
}

export interface Company {
  slug: string;
  name: string;
  domain: string; // used to resolve the logo
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  legalName?: string | null;
  operatingStatus?: OperatingStatus | null;
  companyType?: CompanyType | null;
  primarySector?: Sector | null;
  /** ISO 3166-1 alpha-2 (geography.ts). Null when no source stated a country;
   *  `hq` stays the display string. */
  countryCode?: string | null;
  oneLiner: string;
  description: string;
  hq: string;
  founded: number;
  headcount: number;
  industry: string[];
  status: CompanyStatus;
  stage: Stage;
  totalRaisedUsd: number;
  lastValuationUsd: number | null;
  // Detailed sections — present on fully-profiled companies.
  rounds?: FundingRound[];
  people?: Person[];
  investors?: InvestorHolding[];
  acquisitions?: AcquisitionDeal[];
  exits?: ExitEvent[];
  diversity?: DiversitySignal[];
  financials?: CompanyFinancials;
  /** External identifiers — the crosswalk to EDGAR, GLEIF, Wikidata and the
   *  rest. Detail reads only; the directory pages don't carry them. DOMAIN is
   *  filtered out server-side: the profile already links the website, and
   *  repeating the host as an "identifier" is noise. */
  identifiers?: EntityIdentifierRef[];
  /** Fields withheld from this viewer — partner-written values a signed-out
   *  viewer may not read. The value in the payload is blanked (null, '' or 0),
   *  so the web must check this before rendering one. */
  masked?: string[];
  /** Set (true) only for a signed-out viewer of a company that exists only
   *  because of the partner: the payload is a stub — name, counts, nothing else. */
  partnerOnly?: boolean;
}

/**
 * A company domain as it is stored and matched: the bare host, lower-cased, with any scheme,
 * `www.`, port, path, query or trailing dot removed. `https://www.Example.com/about` →
 * `example.com`. Returns '' when nothing host-like is left.
 */
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}
