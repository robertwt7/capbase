import type { Company, Sector, Stage } from './company';
import type { ViewerAccess } from './contributions';
import type { Vertical } from './verticals';
import type { UnlockBy } from './visibility';

export interface MarketStat {
  sector: string;
  companyCount: number; // approved companies in the sector
  dealCount: number; // approved rounds on approved companies in the sector
  totalRaisedUsd: number;
  medianValuationUsd: number;
  trendPct: number; // deal-volume change, trailing 90 days vs the 90 days before
}

export interface MarketTotals {
  totalRaisedUsd: number;
  dealCount: number; // approved non-grant rounds on approved companies
  // Directory sizes, counted with the same filters the list endpoints use.
  companyCount: number;
  investorCount: number;
  fundCount: number;
  personCount: number;
  quarter: string;
}

/** One vertical's membership (`GET /market/verticals`). Counts are public and unconfigurable,
 *  like every count: they say rows exist, not what they say. */
export interface VerticalStat {
  vertical: Vertical;
  slug: string;
  sector: Sector;
  sectorSlug: string;
  /** Every approved member, partner rows included. */
  companyCount: number;
  /** Members whose verticals are not partner-derived and that are not partner-only — what a
   *  crawler can see. Decides indexability; never reads the gate policy. */
  publicCompanyCount: number;
}

export interface VerticalStageGroup {
  stage: Stage;
  companyCount: number;
  /** Sum of the totals this viewer can see; null when the field is hidden from them. */
  totalRaisedUsd: number | null;
  /** Up to VERTICAL_STAGE_PREVIEW, largest first, gated. */
  companies: Company[];
}

/** `GET /market/verticals/:slug`: the vertical's companies this viewer can see, by stage. */
export interface VerticalMarketResponse {
  stat: VerticalStat;
  indexable: boolean;
  access: ViewerAccess;
  visible: {
    companyCount: number;
    totalRaisedUsd: number | null;
    dealCount: number;
    /** Stages with members, in `STAGES` order. */
    stages: VerticalStageGroup[];
  };
  /** Set when the vertical filter itself is hidden from this viewer. */
  unlockBy: UnlockBy | null;
}

/** One indexable vertical page in the markets sitemap family. */
export interface MarketSitemapEntry {
  /** `<sector-slug>/<vertical-slug>`. */
  slug: string;
  updatedAt: string;
}
