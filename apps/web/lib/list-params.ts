// Lenient searchParams → list-query parsing for the directory pages. Unknown
// or malformed values are dropped (never forwarded to the API, which would 400)
// so hand-edited URLs degrade to the unfiltered view instead of erroring.

import {
  COMPANY_SORTS,
  COMPANY_STATUSES,
  FUND_SORTS,
  FUND_STRATEGIES,
  INVESTOR_SORTS,
  INVESTOR_TYPES,
  SECTORS,
  STAGES,
  type CompanyListQuery,
  type FundListQuery,
  type InvestorListQuery,
} from '@repo/api';

type SearchParams = Record<string, string | undefined>;

const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined =>
  allowed.includes(v as T) ? (v as T) : undefined;

const pageOf = (v: string | undefined): number | undefined => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
};

export function companyListQuery(sp: SearchParams): CompanyListQuery {
  return {
    q: sp.q?.trim() || undefined,
    sector: pick(sp.sector, SECTORS),
    stage: pick(sp.stage, STAGES),
    status: pick(sp.status, COMPANY_STATUSES),
    sort: pick(sp.sort, COMPANY_SORTS),
    page: pageOf(sp.page),
  };
}

export function investorListQuery(sp: SearchParams): InvestorListQuery {
  return {
    q: sp.q?.trim() || undefined,
    type: pick(sp.type, INVESTOR_TYPES),
    sort: pick(sp.sort, INVESTOR_SORTS),
    page: pageOf(sp.page),
  };
}

export function fundListQuery(sp: SearchParams): FundListQuery {
  return {
    q: sp.q?.trim() || undefined,
    strategy: pick(sp.strategy, FUND_STRATEGIES),
    // A manager slug is free text, so it is passed through unvalidated — an
    // unknown slug simply matches nothing rather than 400ing.
    manager: sp.manager?.trim() || undefined,
    sort: pick(sp.sort, FUND_SORTS),
    page: pageOf(sp.page),
  };
}
