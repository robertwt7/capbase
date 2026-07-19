// Shared pagination contract for list endpoints. Directory reads are paginated
// server-side; clients pass query params and receive one page plus the total.

import type { CompanyStatus, InvestorType, Sector, Stage } from './company';

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
