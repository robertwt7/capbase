// Provenance shapes: where a published fact came from (Source/Citation) and how
// it changed over time (Revision). Both are read-only on the public surface —
// citations are minted by contribution and backfill, revisions by moderation.

import type { ReviewableType } from './moderation';

export type SourceType = 'SEC filing' | 'Wikidata' | 'Company website' | 'Press' | 'Other';

export const SOURCE_TYPES: readonly SourceType[] = [
  'SEC filing',
  'Wikidata',
  'Company website',
  'Press',
  'Other',
];

/** Everything citable is reviewable, except a proposal (which is itself a change). */
export type CitableType = Exclude<ReviewableType, 'proposal'>;

export const CITABLE_TYPES: readonly CitableType[] = [
  'company',
  'round',
  'person',
  'investor',
  'acquisition',
  'exit',
  'diversity',
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

export type RevisionAction = 'CREATE' | 'UPDATE';

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
