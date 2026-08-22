import type {
  AcquisitionDeal,
  Company,
  CompanyEditFields,
  CompanyStatus,
  CompanyType,
  DiversitySignal,
  ExitEvent,
  ExitType,
  FundingRound,
  InvestorHolding,
  InvestorType,
  OperatingStatus,
  Person,
  RoundInvestor,
  Sector,
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
    id: row.id,
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
    id: row.id,
    name: row.name,
    role: row.role,
    since: row.since,
    ...(row.prior ? { prior: row.prior } : {}),
    linkedinUrl: row.linkedinUrl,
    title: row.title,
  };
}

/** The linked firm, when the caller included it. Only an APPROVED investor gets
 *  a slug: a pending firm has no public page to link to. */
type DbHoldingWithInvestor = DbInvestorHolding & {
  investor?: { slug: string; moderationStatus: string } | null;
};

export function toInvestorHolding(row: DbHoldingWithInvestor): InvestorHolding {
  return {
    id: row.id,
    slug: row.investor?.moderationStatus === 'APPROVED' ? row.investor.slug : null,
    name: row.name,
    type: row.type as InvestorType,
    firstRound: row.firstRound,
    rounds: row.rounds,
    websiteUrl: row.websiteUrl,
    linkedinUrl: row.linkedinUrl,
  };
}

export function toAcquisition(row: DbAcquisitionDeal): AcquisitionDeal {
  return {
    id: row.id,
    target: row.target,
    date: dateOnly(row.date),
    amountUsd: numN(row.amountUsd),
    rationale: row.rationale,
  };
}

export function toExit(row: DbExitEvent): ExitEvent {
  return {
    id: row.id,
    type: row.type as ExitType,
    date: dateOnly(row.date),
    valueUsd: numN(row.valueUsd),
    detail: row.detail,
  };
}

export function toDiversity(row: DbDiversitySignal): DiversitySignal {
  return { id: row.id, label: row.label, value: row.value, note: row.note };
}

/** The proposal-editable view of a Company row, in `CompanyEditFields` value
    shapes (BigInt → number). Used to strip no-op changes at submit time and to
    show reviewers the current values at list time. */
export function toCompanyEditFields(row: DbCompany): Required<CompanyEditFields> {
  return {
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
    websiteUrl: row.websiteUrl,
    linkedinUrl: row.linkedinUrl,
    twitterUrl: row.twitterUrl,
    legalName: row.legalName,
    operatingStatus: row.operatingStatus as OperatingStatus | null,
    companyType: row.companyType as CompanyType | null,
    primarySector: row.primarySector as Sector | null,
  };
}

/** Maps a Company row (optionally with relations) to the shared Company type. */
export function toCompany(row: DbCompanyWithRelations): Company {
  const company: Company = {
    slug: row.slug,
    name: row.name,
    domain: row.domain,
    websiteUrl: row.websiteUrl,
    linkedinUrl: row.linkedinUrl,
    twitterUrl: row.twitterUrl,
    legalName: row.legalName,
    operatingStatus: row.operatingStatus as OperatingStatus | null,
    companyType: row.companyType as CompanyType | null,
    primarySector: row.primarySector as Sector | null,
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
