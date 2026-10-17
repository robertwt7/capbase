import type { FundStatus, FundStrategy, InvestorType } from './company';
import type { Citation } from './provenance';

/** One private fund, with the manager it belongs to. */
export interface Fund {
  /** Row identity — what a Citation anchors to. */
  id: string;
  /** The fund page's address (`/funds/<slug>`). Null only for a row written
   *  before slugs existed and not yet backfilled (`backfill-fund-slugs`). */
  slug: string | null;
  name: string;
  strategy?: FundStrategy | null;
  status?: FundStatus | null;
  vintageYear?: number | null;
  /** Target raise. Null is common and honest: most pooled Form D filings
   *  declare an indefinite offering. */
  targetUsd?: number | null;
  /** Capital closed to date (Form D), or the fund's size (data partners). */
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

/** The lifecycle dates and terms only the fund page shows. All optional: no
 *  public filing reports them, so most funds have none. Percentages are as
 *  published (2.0 means 2%). */
export interface FundTerms {
  /** When fundraising launched. */
  launchDate?: string | null;
  /** The most recent interim (or final) close. */
  latestCloseDate?: string | null;
  finalCloseDate?: string | null;
  hardCapUsd?: number | null;
  managementFeePct?: number | null;
  carriedInterestPct?: number | null;
  hurdleRatePct?: number | null;
  targetIrrNetMinPct?: number | null;
  targetIrrNetMaxPct?: number | null;
  targetIrrGrossMinPct?: number | null;
  targetIrrGrossMaxPct?: number | null;
  regionFocus?: string | null;
}

/** One limited partner's commitment to a fund. */
export interface FundCommitmentRow {
  id: string;
  /** The committing investor (the LP). */
  investor: { slug: string; name: string; type: InvestorType };
  amountUsd: number | null;
  /** As published, in `currency`; null for a USD commitment. */
  amountLocal: number | null;
  currency: string;
}

/** A point-in-time figure for a fund. */
export interface FundMetricRow {
  /** ISO date. */
  asAt: string;
  aumUsd: number | null;
  dryPowderUsd: number | null;
  unrealizedUsd: number | null;
}

/** `GET /funds/:slug` — the fund page. */
export interface FundDetailResponse {
  fund: FundSummary & FundTerms;
  /** The largest commitments first, capped (`commitmentCount` is the total). */
  commitments: FundCommitmentRow[];
  commitmentCount: number;
  metrics: FundMetricRow[];
  /** Citations attesting the fund row (SEC funds; partner funds carry none). */
  citations: Citation[];
  /** `fundIndexable` — whether search engines should index the page. */
  indexable: boolean;
}

/** Sitemap entry for an indexable fund page. */
export interface FundSlugEntry {
  slug: string;
  updatedAt: string;
}

/** An investor's commitment to a fund, as the LP's profile lists it. */
export interface InvestorCommitmentRow {
  id: string;
  fund: { slug: string | null; name: string; vintageYear: number | null; strategy: FundStrategy | null };
  manager: { slug: string; name: string };
  amountUsd: number | null;
  amountLocal: number | null;
  currency: string;
}
