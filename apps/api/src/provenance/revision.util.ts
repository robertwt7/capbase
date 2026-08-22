import type { ReviewableType } from '@repo/api';
import { toJsonValue, type JsonColumnValue } from '@repo/db';

// `toJsonValue` lives in @repo/db because apps/jobs writes revisions too and
// the two must never drift on BigInt/Date handling. Re-exported here so the
// API's revision code reads from one place.
export { toJsonValue, type JsonColumnValue };

/** Everything citable/revisable — the reviewable types minus `proposal`, which
    is a change rather than a row a change can land on. */
export type RevisableType = Exclude<ReviewableType, 'proposal'>;

/** One row of the `Revision` table, in `createMany` shape. */
export interface RevisionInput {
  companyId: string;
  entityType: RevisableType;
  entityId: string;
  field: string;
  before: JsonColumnValue;
  after: JsonColumnValue;
  action: 'CREATE' | 'UPDATE';
  actor: 'USER' | 'ADMIN' | 'INGEST';
  actorUserId?: string | null;
  actorSource?: string | null;
  proposalId?: string | null;
}

/** A whole-row CREATE entry: the row became public, so there is no `before`. */
export function createRevision(args: {
  companyId: string;
  entityType: RevisableType;
  entityId: string;
  after: unknown;
  actorUserId: string;
}): RevisionInput {
  return {
    companyId: args.companyId,
    entityType: args.entityType,
    entityId: args.entityId,
    field: '',
    before: toJsonValue(null),
    after: toJsonValue(args.after),
    action: 'CREATE',
    actor: 'ADMIN',
    actorUserId: args.actorUserId,
  };
}
