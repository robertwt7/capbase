import type { InvestorType } from './company';

/** A unique investor aggregated from approved InvestorHolding rows. */
export interface InvestorSummary {
  /** Canonical investor name (grouping key). */
  name: string;
  /** Most-frequent type across this investor's holdings. */
  type: InvestorType;
  /** Number of distinct approved companies this investor backs. */
  portfolioCount: number;
  /** Distinct sectors across the portfolio (may include none if unset). */
  sectors: string[];
  /** Small sample for the row's portfolio preview. */
  companies: { slug: string; name: string; domain: string }[];
}
