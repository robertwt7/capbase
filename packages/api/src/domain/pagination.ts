// Shared pagination contract for list endpoints. Directory reads are paginated
// server-side; clients pass query params and receive one page plus the total.

import type { CompanyStatus, FundStrategy, InvestorType, Sector, Stage } from './company';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number; // 1-based
  pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export type CompanySort = 'name' | 'raised' | 'valuation';

export const COMPANY_SORTS: readonly CompanySort[] = ['name', 'raised', 'valuation'];

export interface CompanyListQuery {
  q?: string;
  sector?: Sector;
  stage?: Stage;
  status?: CompanyStatus;
  sort?: CompanySort;
  page?: number;
  pageSize?: number;
  /** Comma-separated slug list — fetches exactly those companies (compare page). */
  slugs?: string;
}

export type InvestorSort = 'portfolio' | 'name';

export const INVESTOR_SORTS: readonly InvestorSort[] = ['portfolio', 'name'];

export interface InvestorListQuery {
  q?: string;
  type?: InvestorType;
  sort?: InvestorSort;
  page?: number;
  pageSize?: number;
}

/** Roles-first by default: a person at six companies is the interesting one,
 *  and it is the only ordering the data supports. Role STRINGS are 3,744
 *  distinct free-text values, so there is no role filter — only search, the
 *  multi-company flag, and this sort. */
export type PersonSort = 'roles' | 'name';

export const PERSON_SORTS: readonly PersonSort[] = ['roles', 'name'];

export interface PersonListQuery {
  q?: string;
  /** Only people with a role at more than one company. */
  multiCompany?: boolean;
  sort?: PersonSort;
  page?: number;
  pageSize?: number;
}

export type FundSort = 'size' | 'vintage' | 'name';

export const FUND_SORTS: readonly FundSort[] = ['size', 'vintage', 'name'];

export interface FundListQuery {
  q?: string;
  strategy?: FundStrategy;
  /** Restrict to one manager (the investor profile's "see all funds" link). */
  manager?: string; // investor slug
  sort?: FundSort;
  page?: number;
  pageSize?: number;
}
