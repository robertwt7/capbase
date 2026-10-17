// Shared pagination contract for list endpoints. Directory reads are paginated
// server-side; clients pass query params and receive one page plus the total.

import type { CompanyStatus, FundStatus, FundStrategy, InvestorType, Sector, Stage } from './company';
import type { CountryCode } from './geography';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number; // 1-based
  pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * URLs per child sitemap (the protocol caps one file at 50,000). Each
 * `GET /<family>/sitemap?page=N` (0-based) returns exactly one such page, and
 * `GET /<family>/sitemap/count` sizes the index — so no request ever holds a
 * whole family. Whole-family reads (24 MB of JSON for ~340k companies) ran a
 * 512 MB API container out of heap under a crawler's parallel fetches.
 */
export const SITEMAP_PAGE_SIZE = 45_000;

/** `GET /<family>/sitemap/count`. */
export interface SitemapCount {
  count: number;
}

export type CompanySort = 'name' | 'raised' | 'valuation';

export const COMPANY_SORTS: readonly CompanySort[] = ['name', 'raised', 'valuation'];

/** `/companies/featured` — a rotating sample from the most-followed, best-documented
    companies, for the landing page. Not paginated: it is a shop window, not a list. */
export const DEFAULT_FEATURED_LIMIT = 8;
export const MAX_FEATURED_LIMIT = 24;

export interface CompanyListQuery {
  q?: string;
  sector?: Sector;
  stage?: Stage;
  status?: CompanyStatus;
  /** ISO 3166-1 alpha-2. */
  country?: CountryCode;
  sort?: CompanySort;
  page?: number;
  pageSize?: number;
  /** Comma-separated slug list — fetches exactly those companies (compare page). */
  slugs?: string;
  /** Exact match on the normalised host (`normalizeDomain`). Public API only: callers check
   *  for an existing company before creating one. */
  domain?: string;
}

export type InvestorSort = 'portfolio' | 'name';

export const INVESTOR_SORTS: readonly InvestorSort[] = ['portfolio', 'name'];

export interface InvestorListQuery {
  q?: string;
  type?: InvestorType;
  /** ISO 3166-1 alpha-2. */
  country?: CountryCode;
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
  status?: FundStatus;
  /** Restrict to one manager (the investor profile's "see all funds" link). */
  manager?: string; // investor slug
  sort?: FundSort;
  page?: number;
  pageSize?: number;
}
