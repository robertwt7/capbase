// Shapes for contribution-gated reads and the user's own contribution history.
//
// Two rules decide what a viewer receives, both applied in the API so a hidden
// value never reaches the browser:
//   1. By section — every profile section has a tier (`GATED_SECTIONS`):
//      `open` previews to everyone, `members` previews only to a signed-in
//      viewer, `contributors` shows nothing until unlocked. Full access is earned
//      by an approved contribution and kept alive by a rolling window.
//   2. By provenance — anything the licensed partner wrote is `members` at
//      least (`partnerVisible`): a signed-out viewer never receives it.

import type { Company, ReviewStatus } from './company';
import type { ReviewableType } from './moderation';
import type { Citation } from './provenance';

// Rows shown per detail section to a locked (non-contributing) viewer.
export const PREVIEW_LIMIT = 2;
// Rolling window: a contribution keeps full access alive for this many days.
export const CONTRIBUTION_WINDOW_DAYS = 30;

export type GateTier = 'open' | 'members' | 'contributors';

/**
 * The tier of every gated profile section. Signed out / signed in but locked /
 * unlocked see: `open` 2 / 2 / all, `members` 0 / 2 / all, `contributors`
 * 0 / 0 / all. Counts are never gated — a count says rows exist, not what they
 * say, and it is what invites the sign-in.
 */
export const GATED_SECTIONS = {
  companyRounds: 'members',
  companyDiversity: 'members',
  companyAcquisitions: 'members',
  companyExits: 'members',
  companyInvestors: 'open',
  companyPeople: 'open',
  investorPortfolio: 'open',
  investorPeople: 'open',
  investorFunds: 'open',
  investorCommitments: 'members',
  fundCommitments: 'members',
  fundMetrics: 'members',
  fundTerms: 'contributors',
  personRoles: 'open',
} as const satisfies Record<string, GateTier>;

export type GatedSection = keyof typeof GATED_SECTIONS;

/** Rows of `section` this viewer may receive. Infinity when unlocked. */
export function gateLimit(section: GatedSection, access: ViewerAccess): number {
  if (access.unlocked) return Infinity;
  const tier: GateTier = GATED_SECTIONS[section];
  if (tier === 'contributors') return 0;
  if (tier === 'members' && !access.signedIn) return 0;
  return PREVIEW_LIMIT;
}

/** Partner data is `members` at minimum: hidden from signed-out viewers only. */
export const partnerVisible = (access: ViewerAccess): boolean => access.signedIn || access.unlocked;

/** `ViewerAccess` plus the preview size, for a read that truncates sections. */
export interface GateAccess extends ViewerAccess {
  /** Rows shown per previewed section when locked. */
  previewLimit: number;
}

export interface CompanyAccess extends GateAccess {
  /** Full section counts — every approved row, partner rows included — so a
   *  locked UI can say "2 of N". */
  totals: {
    rounds: number;
    people: number;
    investors: number;
    acquisitions: number;
    exits: number;
    diversity: number;
  };
}

/** Whether the contribution gate is open for a viewer. Computed in one place
    (`UsersService.accessFor`) and carried in-band by every gated read. */
export interface ViewerAccess {
  /** True if the viewer is an admin or has an approved contribution within the window. */
  unlocked: boolean;
  /** False for an anonymous viewer — picks "Sign in" vs "Contribute". */
  signedIn: boolean;
  /** ISO timestamp full access expires (latest contribution + window), or null. */
  unlockedUntil: string | null;
}

/** `/companies/featured`: the landing sample, plus the viewer's gate state so
    the page can decide how much of it to blur without a second request. */
export interface FeaturedCompaniesResponse {
  items: Company[];
  access: ViewerAccess;
}

export interface CompanyDetailResponse {
  /** Sections are already truncated per `gateLimit` when access is locked. */
  company: Company;
  access: CompanyAccess;
  /** The funding summary line everyone may read: the latest round this viewer
   *  may see the name and date of (a public one, for a signed-out viewer). */
  latestRound: { stage: string; date: string } | null;
  /** Every citation attaching to the company row or a child row *in this
      response*, flat. The client indexes by `entityId` + `field`. Truncated
      rows contribute none, so a locked viewer learns nothing extra from them. */
  citations: Citation[];
}

export interface MyContribution {
  type: ReviewableType;
  id: string;
  label: string;
  companySlug: string | null;
  companyName: string | null;
  /** The firm an investor edit targets; null for every other type. */
  investorSlug: string | null;
  investorName: string | null;
  moderationStatus: ReviewStatus;
  createdAt: string;
}

export interface MyContributionsResponse {
  access: ViewerAccess;
  items: MyContribution[];
}
