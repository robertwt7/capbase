// Shapes for company edit proposals: a field-level diff against an existing
// Company, held as a PENDING ChangeProposal and applied on moderation approval.

import type { CompanyStatus, CompanyType, OperatingStatus, Sector, Stage } from './company';

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
}

/** Payload the admin queue carries for a proposal: the diff + live current values. */
export interface ChangeProposalReview {
  changes: CompanyEditFields;
  /** Same keys as `changes`, valued from the Company row at list time. */
  current: CompanyEditFields;
  note: string | null;
}
