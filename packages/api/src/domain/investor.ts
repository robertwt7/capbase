import type { InvestorType } from './company';

/** A first-class investor firm. Exists independently of any portfolio edge, so
 *  firms whose investments we don't know yet still have an identity and a page. */
export interface Investor {
  slug: string;
  name: string;
  /** Registered legal name, when it differs from the trading name. */
  legalName?: string | null;
  type: InvestorType;
  hq?: string | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  /** Used to resolve the logo, same as Company.domain. */
  domain?: string | null;
  description?: string | null;
  /** Number of private funds the firm reports (SEC Form ADV). */
  fundCount?: number | null;
  /** Gross assets across those funds, USD (SEC Form ADV). */
  assetsUsd?: number | null;
  foundedYear?: number | null;
}

/** A unique investor with the portfolio facts the directory row needs. */
export interface InvestorSummary extends Investor {
  /** Number of distinct approved companies this investor backs (0 is normal). */
  portfolioCount: number;
  /** Distinct sectors across the portfolio (may include none if unset). */
  sectors: string[];
  /** Small sample for the row's portfolio preview. */
  companies: { slug: string; name: string; domain: string }[];
}

/** Full investor profile: every approved portfolio company, not a sample. */
export type InvestorDetailResponse = InvestorSummary;

/** Lightweight listing entry for the web sitemap: every APPROVED investor. */
export interface InvestorSlugEntry {
  slug: string;
  updatedAt: string; // ISO timestamp of the row's last update
}
