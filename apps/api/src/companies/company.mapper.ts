import type {
  AcquisitionDeal,
  Company,
  CompanyStatus,
  DiversitySignal,
  ExitEvent,
  ExitType,
  FundingRound,
  InvestorHolding,
  InvestorType,
  Person,
  RoundInvestor,
  Stage,
} from '@repo/api';

import type {
  AcquisitionDeal as DbAcquisitionDeal,
  Company as DbCompany,
  DiversitySignal as DbDiversitySignal,
  ExitEvent as DbExitEvent,
  FundingRound as DbFundingRound,
  InvestorHolding as DbInvestorHolding,
  Person as DbPerson,
  RoundInvestor as DbRoundInvestor,
} from '@repo/db';

const numN = (v: bigint | null): number | null => (v === null ? null : Number(v));
const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

type DbRoundWithInvestors = DbFundingRound & { investors: DbRoundInvestor[] };

export type DbCompanyWithRelations = DbCompany & {
  rounds?: DbRoundWithInvestors[];
  people?: DbPerson[];
  investors?: DbInvestorHolding[];
  acquisitions?: DbAcquisitionDeal[];
  exits?: DbExitEvent[];
  diversity?: DbDiversitySignal[];
};

export function toRoundInvestor(row: DbRoundInvestor): RoundInvestor {
  return { name: row.name, lead: row.lead };
}

export function toFundingRound(row: DbRoundWithInvestors): FundingRound {
  return {
    name: row.name,
    date: dateOnly(row.date),
    amountUsd: Number(row.amountUsd),
    postMoneyUsd: numN(row.postMoneyUsd),
    lead: row.lead,
    investors: (row.investors ?? []).map(toRoundInvestor),
  };
}

export function toPerson(row: DbPerson): Person {
  return {
    name: row.name,
    role: row.role,
    since: row.since,
    ...(row.prior ? { prior: row.prior } : {}),
  };
}

export function toInvestorHolding(row: DbInvestorHolding): InvestorHolding {
  return {
    name: row.name,
    type: row.type as InvestorType,
    firstRound: row.firstRound,
    rounds: row.rounds,
  };
}

export function toAcquisition(row: DbAcquisitionDeal): AcquisitionDeal {
  return {
    target: row.target,
    date: dateOnly(row.date),
    amountUsd: numN(row.amountUsd),
    rationale: row.rationale,
  };
}

export function toExit(row: DbExitEvent): ExitEvent {
  return {
    type: row.type as ExitType,
    date: dateOnly(row.date),
    valueUsd: numN(row.valueUsd),
    detail: row.detail,
  };
}

export function toDiversity(row: DbDiversitySignal): DiversitySignal {
  return { label: row.label, value: row.value, note: row.note };
}

/** Maps a Company row (optionally with relations) to the shared Company type. */
export function toCompany(row: DbCompanyWithRelations): Company {
  const company: Company = {
    slug: row.slug,
    name: row.name,
    domain: row.domain,
    oneLiner: row.oneLiner,
    description: row.description,
    hq: row.hq,
    founded: row.founded,
    headcount: row.headcount,
    industry: row.industry,
    status: row.status as CompanyStatus,
    stage: row.stage as Stage,
    totalRaisedUsd: Number(row.totalRaisedUsd),
    lastValuationUsd: numN(row.lastValuationUsd),
  };

  if (row.revenueUsd !== null) {
    company.financials = {
      revenueUsd: Number(row.revenueUsd),
      revenueGrowthPct: row.revenueGrowthPct ?? 0,
      grossMarginPct: row.grossMarginPct ?? 0,
      burnMonths: row.burnMonths,
    };
  }
  if (row.rounds) company.rounds = row.rounds.map(toFundingRound);
  if (row.people) company.people = row.people.map(toPerson);
  if (row.investors) company.investors = row.investors.map(toInvestorHolding);
  if (row.acquisitions) company.acquisitions = row.acquisitions.map(toAcquisition);
  if (row.exits) company.exits = row.exits.map(toExit);
  if (row.diversity) company.diversity = row.diversity.map(toDiversity);

  return company;
}
