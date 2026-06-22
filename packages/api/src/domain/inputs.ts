// Payload shapes for crowdsourced contributions. The NestJS DTO classes
// (apps/api) implement these interfaces and attach class-validator decorators;
// the web app reuses them to type its submission forms.

import type {
  CompanyFinancials,
  CompanyStatus,
  ExitType,
  InvestorType,
  RoundInvestor,
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
}

export interface CreateInvestorInput {
  name: string;
  type: InvestorType;
  firstRound: string;
  rounds: number;
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
