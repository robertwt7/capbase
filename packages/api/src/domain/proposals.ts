// Shapes for company edit proposals: a field-level diff against an existing
// Company, held as a PENDING ChangeProposal and applied on moderation approval.

import type {
  CompanyStatus,
  CompanyType,
  InvestorType,
  OperatingStatus,
  Sector,
  Stage,
} from './company';
import type { CountryCode } from './geography';

/** Editable Company fields — all optional; a proposal carries only what changed. */
export interface CompanyEditFields {
  name?: string;
  domain?: string;
  oneLiner?: string;
  description?: string;
  hq?: string;
  founded?: number;
  headcount?: number;
  industry?: string[];
  status?: CompanyStatus;
  stage?: Stage;
  totalRaisedUsd?: number;
  lastValuationUsd?: number | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  legalName?: string | null;
  operatingStatus?: OperatingStatus | null;
  companyType?: CompanyType | null;
  primarySector?: Sector | null;
}

export interface CreateChangeProposalInput {
  changes: CompanyEditFields;
  note?: string | null;
  /** Primary document backing the edit. Materialised into one Citation per
      changed field when the proposal is approved — this is where field-level
      citation earns its name. Deliberately NOT part of `CompanyEditFields`:
      that is the editable-column whitelist and must not grow. */
  sourceUrl?: string | null;
  /** The contribution attestation (Terms §4). Must be true; the API rejects anything else. */
  attested: boolean;
}

/** Payload the admin queue carries for a proposal: the diff + live current values. */
export interface ChangeProposalReview {
  changes: CompanyEditFields;
  /** Same keys as `changes`, valued from the Company row at list time. */
  current: CompanyEditFields;
  note: string | null;
}

// --- Investor-firm edit proposals (public API only) -------------------------
// The same shape as a company proposal, against an Investor row. Approval writes no Revision and
// no Citation (a firm has no company to anchor a timeline to); the replaced values are kept on
// the proposal itself.

/** Editable investor-firm fields. ADV facts (crd/cik/fundCount/assetsUsd) are ingest-owned. */
export interface InvestorEditFields {
  name?: string;
  legalName?: string | null;
  type?: InvestorType;
  hq?: string | null;
  countryCode?: CountryCode | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  domain?: string | null;
  description?: string | null;
  foundedYear?: number | null;
}

/** The keys of InvestorEditFields, in display order — the whitelist an approval applies. */
export const INVESTOR_EDIT_FIELDS: readonly (keyof InvestorEditFields)[] = [
  'name',
  'legalName',
  'type',
  'hq',
  'countryCode',
  'websiteUrl',
  'linkedinUrl',
  'domain',
  'description',
  'foundedYear',
];

export interface CreateInvestorProposalInput {
  changes: InvestorEditFields;
  note?: string | null;
  /** Stored on the proposal; firm-level citations don't exist. */
  sourceUrl?: string | null;
  /** The contribution attestation (Terms §4). Must be true. */
  attested: boolean;
}

/** Payload the admin queue carries for an investor proposal. */
export interface InvestorProposalReview {
  investor: { slug: string; name: string };
  changes: InvestorEditFields;
  /** Same keys as `changes`, valued from the Investor row at list time. */
  current: InvestorEditFields;
  /** The values the approval replaced; null until approved. */
  previous: InvestorEditFields | null;
  note: string | null;
}
