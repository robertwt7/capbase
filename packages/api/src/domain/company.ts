// Shared domain types for Capbase. These are the single source of truth for the
// shapes exchanged between the NestJS API (apps/api) and the Next.js web app
// (apps/web). Keep them runtime-dependency-free — plain TypeScript only.

export type Stage =
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

export type InvestorType = 'Venture' | 'Growth' | 'Angel' | 'Corporate' | 'Private equity';

export const INVESTOR_TYPES: readonly InvestorType[] = [
  'Venture',
  'Growth',
  'Angel',
  'Corporate',
  'Private equity',
];

export type ExitType = 'IPO' | 'Acquisition' | 'Secondary';

export const EXIT_TYPES: readonly ExitType[] = ['IPO', 'Acquisition', 'Secondary'];

/** Moderation state of a crowdsourced row. Public reads only return APPROVED. */
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface RoundInvestor {
  name: string;
  lead: boolean;
}

export interface FundingRound {
  /** Round label, e.g. "Series B". Rounds are an ordered sequence. */
  name: string;
  date: string; // ISO date the round was announced
  amountUsd: number; // capital raised in this round
  postMoneyUsd: number | null; // post-money valuation, when disclosed
  lead: string | null;
  investors: RoundInvestor[];
}

export interface Person {
  name: string;
  role: string;
  since: number; // year joined
  prior?: string; // notable prior affiliation
}

export interface InvestorHolding {
  name: string;
  type: InvestorType;
  firstRound: string;
  rounds: number; // how many rounds they participated in
}

export interface AcquisitionDeal {
  /** The company Capbase's subject acquired. */
  target: string;
  date: string;
  amountUsd: number | null;
  rationale: string;
}

export interface ExitEvent {
  type: ExitType;
  date: string;
  valueUsd: number | null;
  detail: string;
}

export interface DiversitySignal {
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

export interface Company {
  slug: string;
  name: string;
  domain: string; // used to resolve the logo
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
}
