// Visitor reports about a public profile ("Report an issue"). Same convention as
// the other controlled vocabularies here: a string-literal union plus a
// `readonly` const array, stored as a plain String column and validated in DTOs
// with @IsIn([...]). Runtime-dependency-free.

import type { IdentifiableType } from './identifiers';

/** What a report can be about: one public profile. Same set as
 *  `IdentifiableType` — and, like it, `'person'` means the `Person` row (the
 *  human), not a `PersonRole`. */
export type ReportableType = IdentifiableType;
export const REPORTABLE_TYPES: readonly ReportableType[] = [
  'company',
  'investor',
  'person',
];

export type ReportReason =
  | 'Incorrect'
  | 'Outdated'
  | 'Personal data removal'
  | 'Copyright or legal'
  | 'Other';
export const REPORT_REASONS: readonly ReportReason[] = [
  'Incorrect',
  'Outdated',
  'Personal data removal',
  'Copyright or legal',
  'Other',
];

/** OPEN, not PENDING: a report is not a moderated row and never becomes public. */
export type ReportStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';
export const REPORT_STATUSES: readonly ReportStatus[] = [
  'OPEN',
  'RESOLVED',
  'DISMISSED',
];

export const REPORT_MESSAGE_MIN = 10;
export const REPORT_MESSAGE_MAX = 5000;

/** Public submission. The profile is named by slug — the web domain types
 *  carry no row id for companies and investors. */
export interface CreateReportInput {
  entityType: ReportableType;
  slug: string;
  reason: ReportReason;
  message: string;
  email?: string;
}

/** A report as the admin queue shows it. `entity` is resolved at read time and
 *  is null when the row no longer exists. */
export interface ReportItem {
  id: string;
  entityType: ReportableType;
  entityId: string;
  entity: { name: string; slug: string; suppressed: boolean } | null;
  reason: ReportReason;
  message: string;
  email: string | null;
  status: ReportStatus;
  resolutionNote: string | null;
  resolutionUrl: string | null;
  resolvedAt: string | null;
  /** The resolving admin's email. */
  resolvedBy: string | null;
  createdAt: string;
}

export interface ReportQueueResponse {
  items: ReportItem[];
  total: number;
}

export interface ResolveReportInput {
  note?: string;
  url?: string;
  /** Person reports only: also set Person.suppressedAt (the profile 404s). */
  suppressPerson?: boolean;
}

export interface DismissReportInput {
  note?: string;
}
