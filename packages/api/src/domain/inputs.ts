// Payload shapes for crowdsourced contributions. The NestJS DTO classes
// (apps/api) implement these interfaces and attach class-validator decorators;
// the web app reuses them to type its submission forms.

import type {
  CompanyFinancials,
  CompanyStatus,
  CompanyType,
  ExitType,
  InvestorType,
  OperatingStatus,
  RoundInvestor,
  Sector,
  Stage,
} from './company';

export interface CreateCompanyInput {
  name: string;
  domain: string;
  oneLiner: string;
  description: string;
  hq: string;
  founded: number;
  headcount: number;
  industry: string[];
  status: CompanyStatus;
  stage: Stage;
  totalRaisedUsd: number;
  lastValuationUsd?: number | null;
  financials?: CompanyFinancials;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  legalName?: string | null;
  operatingStatus?: OperatingStatus | null;
  companyType?: CompanyType | null;
  primarySector?: Sector | null;
}

export interface CreateFundingRoundInput {
  name: string;
  date: string;
  amountUsd: number;
  postMoneyUsd?: number | null;
  lead?: string | null;
  investors: RoundInvestor[];
}

export interface CreatePersonInput {
  name: string;
  role: string;
  since: number;
  prior?: string;
  linkedinUrl?: string | null;
  title?: string | null;
}

export interface CreateInvestorInput {
  name: string;
  type: InvestorType;
  firstRound: string;
  rounds: number;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
}

export interface CreateAcquisitionInput {
  target: string;
  date: string;
  amountUsd?: number | null;
  rationale: string;
}

export interface CreateExitInput {
  type: ExitType;
  date: string;
  valueUsd?: number | null;
  detail: string;
}

export interface CreateDiversityInput {
  label: string;
  value: string;
  note: string;
}
