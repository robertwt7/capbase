import {
  normalizeIdentifier,
  type IdentifiableType,
  type IdentifierScheme,
  type MergeSignal,
} from '@repo/api';

/**
 * The slice of the Prisma client this module touches. Narrowed to a structural
 * type so the identifier backfill, the ingest path and the specs all call the
 * same code without dragging the whole generated client into a test fixture.
 */
export interface IdentifierWriterClient {
  entityIdentifier: {
    findUnique(args: {
      where: { scheme_value_entityType: { scheme: string; value: string; entityType: string } };
      select?: { entityId: true };
    }): Promise<{ entityId: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  mergeCandidate: {
    findUnique(args: {
      where: { entityType_leftId_rightId: { entityType: string; leftId: string; rightId: string } };
      select?: { id: true; signal: true; status: true };
    }): Promise<{ id: string; signal: string; status: string } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

/**
 * What one `writeIdentifier` call did.
 *
 * `conflict` is the interesting one: the (scheme, value, entityType) is already
 * held by a *different* entity, which is precisely the duplicate this whole
 * feature exists to catch. It is not an error and it never overwrites.
 */
export type IdentifierOutcome = 'written' | 'unchanged' | 'skipped' | 'conflict';

/** Running totals a caller reports at the end of a pass. */
export interface IdentifierCounts {
  written: number;
  unchanged: number;
  skipped: number;
  conflict: number;
}

export function emptyCounts(): IdentifierCounts {
  return { written: 0, unchanged: 0, skipped: 0, conflict: 0 };
}

/** Signals ranked strongest-first, so an existing candidate is only ever
 *  upgraded. A pair found by name and later by identifier should read as an
 *  identifier match; the reverse would throw away the better evidence. */
const SIGNAL_RANK: Record<MergeSignal, number> = { identifier: 0, domain: 1, name: 2 };

/**
 * Record one identifier for an entity.
 *
 * Shared by the backfill and by ingest so the two can never drift on how a
 * collision is handled — which matters, because the collision *is* the
 * detection: with `@@unique([scheme, value, entityType])` a duplicate
 * identifier can never land in the table, so there is nothing for a later batch
 * scan to find. The failed write is the only moment it is visible.
 */
export async function writeIdentifier(
  prisma: IdentifierWriterClient,
  args: {
    scheme: IdentifierScheme;
    value: string;
    entityType: IdentifiableType;
    entityId: string;
    source: string;
  },
): Promise<IdentifierOutcome> {
  const value = normalizeIdentifier(args.scheme, args.value);
  // A value we cannot validate is dropped, never stored: a malformed identifier
  // in the crosswalk would join two unrelated entities.
  if (!value) return 'skipped';

  const existing = await prisma.entityIdentifier.findUnique({
    where: {
      scheme_value_entityType: {
        scheme: args.scheme,
        value,
        entityType: args.entityType,
      },
    },
    select: { entityId: true },
  });

  if (existing) {
    if (existing.entityId === args.entityId) return 'unchanged';
    await recordCandidate(prisma, {
      entityType: args.entityType,
      aId: existing.entityId,
      bId: args.entityId,
      signal: 'identifier',
      evidence: `${args.scheme}:${value}`,
    });
    return 'conflict';
  }

  await prisma.entityIdentifier.create({
    data: {
      scheme: args.scheme,
      value,
      entityType: args.entityType,
      entityId: args.entityId,
      source: args.source,
    },
  });
  return 'written';
}

/**
 * Upsert a candidate pair.
 *
 * Ids are ordered canonically so the same pair found from either direction is
 * one row. An existing row is upgraded to a stronger signal but never
 * downgraded, and a pair already MERGED or REJECTED is left alone — a rejected
 * pair must never be re-proposed, which is the whole point of keeping the row
 * after the decision.
 */
export async function recordCandidate(
  prisma: IdentifierWriterClient,
  args: {
    entityType: IdentifiableType;
    aId: string;
    bId: string;
    signal: MergeSignal;
    evidence: string;
  },
): Promise<void> {
  if (args.aId === args.bId) return;
  const [leftId, rightId] = args.aId < args.bId ? [args.aId, args.bId] : [args.bId, args.aId];

  const existing = await prisma.mergeCandidate.findUnique({
    where: { entityType_leftId_rightId: { entityType: args.entityType, leftId, rightId } },
    select: { id: true, signal: true, status: true },
  });

  if (!existing) {
    await prisma.mergeCandidate.create({
      data: {
        entityType: args.entityType,
        leftId,
        rightId,
        signal: args.signal,
        evidence: args.evidence,
      },
    });
    return;
  }

  if (existing.status !== 'PENDING') return;

  const currentRank = SIGNAL_RANK[existing.signal as MergeSignal] ?? SIGNAL_RANK.name;
  if (SIGNAL_RANK[args.signal] < currentRank) {
    await prisma.mergeCandidate.update({
      where: { id: existing.id },
      data: { signal: args.signal, evidence: args.evidence },
    });
  }
}
