// Shapes for contribution-gated reads and the user's own contribution history.
//
// Two rules decide what a viewer receives, both applied in the API so a hidden
// value never reaches the browser, both configurable by an admin (the policy
// and its defaults live in `visibility.ts`):
//   1. By section — every profile section gives each tier (signed out / signed
//      in / unlocked) `hidden`, a `preview` of N rows, or `full`
//      (`SECTION_REGISTRY`, `gateLimit`). Full access is earned by an approved
//      contribution and kept alive by a rolling window.
//   2. By provenance — the partner's rows follow their section's
//      `partnerAudience`, the partner's values each field's (`FIELD_REGISTRY`);
//      partner-only ENTITIES are fixed: a stub signed out (`partnerVisible`).

import type { Company, ReviewStatus } from './company';
import type { ReviewableType } from './moderation';
import type { Citation } from './provenance';
import { sectionLimit, type GatedSection, type GatePolicy, type GateView } from './visibility';

/** Rows of `section` this viewer may receive under `policy`. Infinity = all. */
export function gateLimit(section: GatedSection, access: ViewerAccess, policy: GatePolicy): number {
  return sectionLimit(policy, section, access);
}

/** The ENTITY-level partner rule, fixed: a partner-only company, firm, fund or
 *  person is a stub signed out and absent from signed-out directories, search
 *  and the sitemap. (Partner rows and values follow the policy instead.) */
export const partnerVisible = (access: ViewerAccess): boolean => access.signedIn || access.unlocked;

/** The access a detail read carries. */
export type GateAccess = ViewerAccess;

export interface CompanyAccess extends ViewerAccess {
  /** Full section counts — every approved row, partner rows included — so a
   *  locked UI can say "2 of N". */
  totals: {
    rounds: number;
    people: number;
    investors: number;
    acquisitions: number;
    exits: number;
    diversity: number;
    companyTechnologies?: number;
    companyApps?: number;
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
  /** An admin: every section and value, whatever the policy. */
  admin: boolean;
  /** Days an approved contribution keeps a user unlocked (the live setting). */
  windowDays: number;
}

/** `/companies/featured`: the landing sample, plus the viewer's gate state so
    the page can decide how much of it to blur without a second request. */
export interface FeaturedCompaniesResponse {
  items: Company[];
  access: ViewerAccess;
}

export interface CompanyDetailResponse {
  /** Every public-record company, plus partner-only companies with non-empty
   *  oneLiner or description. The sitemap uses the same rule. */
  indexable: boolean;
  /** Sections are already truncated per `gateLimit`. */
  company: Company;
  access: CompanyAccess;
  /** The funding summary line everyone may read: the latest round this viewer
   *  may see the name and date of (a public one, for a signed-out viewer). */
  latestRound: { stage: string; date: string } | null;
  /** How each section looks to this viewer (`visibility.ts` `sectionView`). */
  gate: GateView;
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
