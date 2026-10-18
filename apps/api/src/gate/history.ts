import { PUBLIC_INGEST_SOURCES } from '@repo/api';
import type { Prisma } from '@repo/db';

/**
 * The history timeline a LOCKED viewer may read — an allowlist, not a denylist,
 * because a revision's `before`/`after` can carry any value a row ever held.
 *
 * An entry is shown only when all hold:
 *   - it is about the company row itself (`entityType: 'company'`) — a child
 *     CREATE carries the whole row (a round's amount, a partner's investors);
 *   - its actor is a moderated human edit or merge (`ADMIN`), or an ingest
 *     source on the public allowlist (`PUBLIC_INGEST_SOURCES`);
 *   - its field has NEVER had a partner revision on this company
 *     (`partnerTouched`): a later public or human value of that field still
 *     carries the partner's value in its `before`.
 */
export function lockedHistoryWhere(companyId: string, partnerTouched: readonly string[]): Prisma.RevisionWhereInput {
  return {
    companyId,
    entityType: 'company',
    ...(partnerTouched.length > 0 ? { field: { notIn: [...partnerTouched] } } : {}),
    OR: [{ actor: 'ADMIN' }, { actor: 'INGEST', actorSource: { in: [...PUBLIC_INGEST_SOURCES] } }],
  };
}
