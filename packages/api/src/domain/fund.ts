import type { FundStrategy } from './company';

/** One private fund, with the manager it belongs to. */
export interface Fund {
  /** Row identity — what a Citation anchors to. Funds have no slug: there is
   *  no per-fund page, so nothing addresses one by name. */
  id: string;
  name: string;
  strategy?: FundStrategy | null;
  vintageYear?: number | null;
  /** Target raise. Null is common and honest: most pooled Form D filings
   *  declare an indefinite offering. */
  targetUsd?: number | null;
  /** Capital closed to date (Form D). */
  closedUsd?: number | null;
  /** Gross asset value as last reported on Form ADV — NAV, not capital raised. */
  grossAssetsUsd?: number | null;
  currency: string;
  hq?: string | null;
}

/** A fund plus enough of its manager to render a directory row. */
export interface FundSummary extends Fund {
  manager: { slug: string; name: string; domain: string | null };
}
