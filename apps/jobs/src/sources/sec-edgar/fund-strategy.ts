import type { FundStrategy } from '@repo/api';

/**
 * Form D `investmentFundType` → the shared vocabulary.
 *
 * Four values, all observed in the sampled filings. "Other Investment Fund" is
 * honestly 'Other' — the filer declined the three specific boxes, which is a
 * fact about the filing, not a gap to fill in from the fund's name.
 */
const FORM_D_FUND_TYPES: Record<string, FundStrategy> = {
  'Venture Capital Fund': 'Venture capital',
  'Private Equity Fund': 'Private equity',
  'Hedge Fund': 'Hedge fund',
  'Other Investment Fund': 'Other',
};

/** Null when the filing declared no fund type at all — a pooled filing that
 *  ticked no box says nothing, and 'Other' would be putting words in it. A
 *  null here lets the ADV strategy for the same fund stand. */
export function fundStrategyForFormD(fundType: string | undefined): FundStrategy | null {
  const key = (fundType ?? '').trim();
  if (!key) return null;
  const exact = FORM_D_FUND_TYPES[key];
  if (exact) return exact;
  const ci = Object.keys(FORM_D_FUND_TYPES).find((k) => k.toLowerCase() === key.toLowerCase());
  return ci ? FORM_D_FUND_TYPES[ci]! : 'Other';
}
