/**
 * Company claims: a user's verified relationship to a company ("this is my company"). A claim
 * is a relationship, not a role — it grants no moderation power and never widens the read gate
 * (`UsersService.accessFor` never reads it).
 *
 * Two ways in: `EMAIL` (a single-use link sent to a work address at the company's stored
 * domain, see `claimDomainMatch` in `domains.ts`) and `MANUAL` (a note + evidence link an admin
 * approves). An `EMAIL` claim is active while it is verified, not revoked, its user is not
 * banned and the company's current domain still equals the one it was verified against; a
 * `MANUAL` one ends only by revocation, withdrawal or a ban.
 */

export const CLAIM_METHODS = ['EMAIL', 'MANUAL'] as const;
export type ClaimMethod = (typeof CLAIM_METHODS)[number];

/** Derived, never stored. `suspended` = an email claim whose company domain no longer matches. */
export type ClaimStatus = 'pending' | 'active' | 'suspended' | 'ended';
export const CLAIM_END_REASONS = ['withdrawn', 'revoked', 'rejected', 'ban'] as const;
export type ClaimEndReason = (typeof CLAIM_END_REASONS)[number];

/** 400 code: the address is not at this company's domain (or a subdomain of it). */
export const CLAIM_DOMAIN_MISMATCH = 'CLAIM_DOMAIN_MISMATCH';
/** 400 code: this company has no domain an email claim can be checked against. */
export const CLAIM_EMAIL_UNAVAILABLE = 'CLAIM_EMAIL_UNAVAILABLE';

/** A claim link works for this long. */
export const CLAIM_TOKEN_TTL_HOURS = 24;
/** One claim link per account per this many seconds. */
export const CLAIM_COOLDOWN_SECONDS = 60;
/** Claim links one account may request in 24 hours (admins included — a claim is not moderation). */
export const CLAIM_ATTEMPTS_PER_USER_PER_DAY = 5;
/** Claim links sent for one company in 24 hours, across every account: bounds the mail
 *  Capbase can be made to send to one company's domain. */
export const CLAIM_ATTEMPTS_PER_COMPANY_PER_DAY = 10;
/** Undecided manual requests one account may hold at once. */
export const MAX_OPEN_CLAIM_REQUESTS = 3;
/** "Confirm still current" at most once per this many hours per claim. */
export const CLAIM_CONFIRM_INTERVAL_HOURS = 24;
export const CLAIM_NOTE_MIN = 20;
export const CLAIM_NOTE_MAX = 2000;
export const CLAIM_EVIDENCE_URL_MAX = 2048;
/** `/admin/claims` page size. */
export const CLAIM_PAGE_SIZE = 25;

/** One of the caller's own claims, as `/profile` and the claim page show it. */
export interface MyCompanyClaim {
  id: string;
  companySlug: string;
  companyName: string;
  method: ClaimMethod;
  status: ClaimStatus;
  endReason: ClaimEndReason | null;
  /** The work address the link was sent to (EMAIL only). The owner's own data. */
  email: string | null;
  verifiedAt: string | null;
  lastConfirmedAt: string | null;
  createdAt: string;
}

/** `GET /companies/:slug/claim` — what the claim page needs. */
export interface CompanyClaimView {
  company: { slug: string; name: string };
  /** Whether the email flow is offered. The domain itself is never sent. */
  emailClaim: boolean;
  claims: MyCompanyClaim[];
}

export interface StartEmailClaimInput {
  email: string;
  authorised: boolean;
}

export interface VerifyClaimInput {
  token: string;
}

export interface VerifyClaimResponse {
  companySlug: string;
  companyName: string;
}

export interface ClaimRequestInput {
  note: string;
  evidenceUrl?: string;
  authorised: boolean;
}

/** A claim as the admin pages show it: everything, private fields included. */
export interface AdminClaim extends MyCompanyClaim {
  userId: string;
  userEmail: string;
  userName: string;
  note: string | null;
  evidenceUrl: string | null;
  /** Name of the admin who revoked / rejected it, when one did. */
  revokedBy: string | null;
  revokedAt: string | null;
  /** Name of the admin who approved a manual request. */
  verifiedBy: string | null;
}

export type AdminClaimStatusFilter = 'pending' | 'active' | 'ended';
export const ADMIN_CLAIM_STATUS_FILTERS: readonly AdminClaimStatusFilter[] = [
  'pending',
  'active',
  'ended',
];

export interface AdminClaimPage {
  items: AdminClaim[];
  total: number;
  page: number;
  pageSize: number;
}

/** Optional rejection reason, quoted in the email and never stored. */
export interface ClaimDecisionInput {
  note?: string;
}

/** `POST /companies/:slug/claim/confirm` answer. */
export interface ConfirmClaimResponse {
  lastConfirmedAt: string;
}
