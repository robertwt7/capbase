// Provenance shapes: where a published fact came from (Source/Citation) and how
// it changed over time (Revision). Both are read-only on the public surface —
// citations are minted by contribution and backfill, revisions by moderation.

import type { ReviewableType } from './moderation';

export type SourceType =
  | 'SEC filing'
  | 'Wikidata'
  /** A government bulk dataset — SBIR.gov award data, and future federal files. */
  | 'Government dataset'
  | 'Company website'
  | 'Press'
  | 'Other';

export const SOURCE_TYPES: readonly SourceType[] = [
  'SEC filing',
  'Wikidata',
  'Government dataset',
  'Company website',
  'Press',
  'Other',
];

/** Everything reviewable is citable, except a proposal (which is itself a
 *  change) — plus `fund`, which is citable without being reviewable: funds are
 *  ingest-only, so they never enter the moderation queue. */
export type CitableType = Exclude<ReviewableType, 'proposal'> | 'fund';

export const CITABLE_TYPES: readonly CitableType[] = [
  'company',
  'round',
  'person',
  'investor',
  'acquisition',
  'exit',
  'diversity',
  'fund',
];

export interface SourceRef {
  url: string;
  sourceType: SourceType;
  title: string | null;
  publisher: string | null;
  reference: string | null;
  retrievedAt: string; // ISO
}

export interface Citation {
  id: string;
  entityType: CitableType;
  entityId: string;
  /** '' means the whole row is attested by this source. */
  field: string;
  note: string | null;
  source: SourceRef;
}

/** MERGE/UNMERGE carry no field diff — they record that a whole row was folded
 *  into another, or split back out. The timeline renders them separately. */
export type RevisionAction = 'CREATE' | 'UPDATE' | 'MERGE' | 'UNMERGE';

export type RevisionActor = 'USER' | 'ADMIN' | 'INGEST';

export interface Revision {
  id: string;
  entityType: CitableType;
  entityId: string;
  /** Human-readable subject, e.g. "Series B round" — resolved server-side. */
  entityLabel: string;
  field: string;
  before: unknown;
  after: unknown;
  action: RevisionAction;
  actor: RevisionActor;
  /** Contributor/admin display name, or the ingest source name. Never an email. */
  actorName: string | null;
  createdAt: string;
}

export interface CompanyHistoryResponse {
  total: number;
  page: number;
  pageSize: number;
  items: Revision[];
}
