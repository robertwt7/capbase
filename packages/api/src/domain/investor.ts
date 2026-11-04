import type { InvestorType, Person } from './company';
import type { GateAccess } from './contributions';
import type { Fund, InvestorCommitmentRow } from './fund';
import type { EntityIdentifierRef } from './identifiers';
import type { Citation } from './provenance';
import type { GateView, UnlockBy } from './visibility';

/** A first-class investor firm. Exists independently of any portfolio edge, so
 *  firms whose investments we don't know yet still have an identity and a page. */
export interface Investor {
  slug: string;
  name: string;
  /** Registered legal name, when it differs from the trading name. */
  legalName?: string | null;
  type: InvestorType;
  hq?: string | null;
  /** ISO 3166-1 alpha-2, same contract as Company.countryCode. */
  countryCode?: string | null;
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
  /** Same contract as Company.identifiers: detail reads only, no DOMAIN. */
  identifiers?: EntityIdentifierRef[];
  /** Same contract as Company.masked. */
  masked?: string[];
  /** Same contract as Company.maskedUnlock. */
  maskedUnlock?: Record<string, UnlockBy>;
  /** Same contract as Company.partnerOnly. */
  partnerOnly?: boolean;
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

export const INVESTOR_FOCUS_ROLES = ['manager', 'lp'] as const;
export type InvestorFocusRole = (typeof INVESTOR_FOCUS_ROLES)[number];

/** A reported min/max. USD is what the firm reported in USD; `currency` with
 *  `minLocal`/`maxLocal` is its own currency (null bounds when USD). A null
 *  bound was not reported — never 0. */
export interface ReportedRange {
  minUsd: number | null;
  maxUsd: number | null;
  currency: string;
  minLocal: number | null;
  maxLocal: number | null;
}

/** What a firm reports it invests in as a fund manager (its own initial equity
 *  cheques). Labels are the publisher's own, never mapped onto `SECTORS`. */
export interface ManagerFocus {
  stages: string[];
  mainStrategy: string | null;
  strategies: string[];
  industries: string[];
  verticals: string[];
  /** Where the firm HAS invested. */
  geographicExposure: string[];
  initialEquityInvestment: ReportedRange | null;
  /** `YYYY-MM-DD`. */
  reportedOn: string;
}

/** What a firm reports it wants as a limited partner (commitments to funds). */
export interface LpFocus {
  strategyPreferences: string[];
  industries: string[];
  verticals: string[];
  /** Where the LP WANTS to commit. */
  geographicPreferences: string[];
  typicalCommitment: ReportedRange | null;
  /** `YYYY-MM-DD`. */
  reportedOn: string;
}

/** A firm's reported investment focus, per role. A historical statement as of
 *  each block's `reportedOn`, not a promise the firm is investing. */
export interface InvestorFocus {
  manager: ManagerFocus | null;
  lp: LpFocus | null;
}

/** Full investor profile. `companies` is the largest `INVESTOR_PORTFOLIO_PREVIEW`
 *  of the portfolio (by capital raised); `portfolioCount` and `sectors` cover all of it. */
export interface InvestorDetailResponse extends InvestorSummary {
  /** Officers of the firm itself (Wikidata P112/P169). The same role rows a
   *  company profile calls `people`. */
  people: Person[];
  /** How many officers/staff the firm has on record — `people` is capped at
   *  `INVESTOR_PEOPLE_PREVIEW`, and a large firm lists thousands. */
  peopleCount: number;
  /** The firm's commitments to funds, as a limited partner — largest first,
   *  capped (`commitmentCount` is the total). Empty for a firm that is not an
   *  LP, which is most of them. */
  commitments: InvestorCommitmentRow[];
  commitmentCount: number;
  /** The largest funds we can name, by gross assets. */
  funds: Fund[];
  /** How many we can name — distinct from `fundCount`, which is what the firm
   *  told the SEC. a16z reports 119 and we can name 92; showing both is the
   *  honest thing. */
  namedFundCount: number;
  /** Citations attesting the fund rows above. */
  citations: Citation[];
  /** Reported investment focus (partner data): null when this viewer may not
   *  see it or the firm has none. Detail read only. */
  focus: InvestorFocus | null;
  /** Roles with a focus on record (0–2), public like every count. */
  focusCount: number;
  /** Whether search engines should index this profile (`indexing.ts`). The
   *  sitemap lists exactly the investors for whom this is true, including a
   *  partner-only firm with a non-empty description. */
  indexable: boolean;
  /** The viewer's gate: each section above holds `gateLimit` rows, while every
   *  count (`portfolioCount`, `peopleCount`, …) covers all of them. */
  access: GateAccess;
  /** How each section looks to this viewer. */
  gate: GateView;
}

/** How many portfolio companies the profile lists — a large venture firm holds
 *  thousands, and a page of thousands of logo tiles is megabytes of HTML. */
export const INVESTOR_PORTFOLIO_PREVIEW = 200;

/** How many of a firm's people the profile lists before saying "N of M". */
export const INVESTOR_PEOPLE_PREVIEW = 60;

/** How many of an LP's commitments the profile lists. */
export const INVESTOR_COMMITMENT_PREVIEW = 24;

/** How many of a fund's commitments the fund page lists. */
export const FUND_COMMITMENT_PREVIEW = 50;

/** Lightweight listing entry for the web sitemap: every indexable investor. */
export interface InvestorSlugEntry {
  slug: string;
  updatedAt: string; // ISO timestamp of the row's last update
}
