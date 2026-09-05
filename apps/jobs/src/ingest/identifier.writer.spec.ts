import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import {
  recordCandidate,
  writeIdentifier,
  type IdentifierWriterClient,
} from './identifier.writer';

interface IdentifierRow {
  scheme: string;
  value: string;
  entityType: string;
  entityId: string;
  source: string;
}

interface CandidateRow {
  id: string;
  entityType: string;
  leftId: string;
  rightId: string;
  signal: string;
  evidence: string;
  status: string;
}

/** In-memory stand-in enforcing the two unique keys the real tables carry, so
 *  the collision paths are exercised rather than mocked away. */
function mockPrisma(seedCandidates: CandidateRow[] = []) {
  const identifiers: IdentifierRow[] = [];
  const candidates: CandidateRow[] = [...seedCandidates];
  let nextCandidateId = seedCandidates.length + 1;

  const client = {
    entityIdentifier: {
      findUnique: jest.fn(async (args: Parameters<IdentifierWriterClient['entityIdentifier']['findUnique']>[0]) => {
        const k = args.where.scheme_value_entityType;
        const hit = identifiers.find(
          (r) => r.scheme === k.scheme && r.value === k.value && r.entityType === k.entityType,
        );
        return hit ? { entityId: hit.entityId } : null;
      }),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        identifiers.push(args.data as unknown as IdentifierRow);
        return args.data;
      }),
    },
    mergeCandidate: {
      findUnique: jest.fn(async (args: Parameters<IdentifierWriterClient['mergeCandidate']['findUnique']>[0]) => {
        const k = args.where.entityType_leftId_rightId;
        return (
          candidates.find(
            (c) =>
              c.entityType === k.entityType && c.leftId === k.leftId && c.rightId === k.rightId,
          ) ?? null
        );
      }),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        const row = {
          id: `cand-${nextCandidateId++}`,
          status: 'PENDING',
          ...args.data,
        } as unknown as CandidateRow;
        candidates.push(row);
        return row;
      }),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = candidates.find((c) => c.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      }),
    },
  };

  return { client: client as unknown as IdentifierWriterClient, identifiers, candidates };
}

describe('writeIdentifier', () => {
  let db: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    db = mockPrisma();
  });

  it('writes a normalized value once and is a no-op the second time', async () => {
    const args = {
      scheme: 'CIK' as const,
      value: '320193',
      entityType: 'company' as const,
      entityId: 'c-1',
      source: 'BACKFILL',
    };

    expect(await writeIdentifier(db.client, args)).toBe('written');
    expect(db.identifiers).toHaveLength(1);
    // Stored canonically, not as the source wrote it.
    expect(db.identifiers[0]!.value).toBe('0000320193');

    expect(await writeIdentifier(db.client, args)).toBe('unchanged');
    expect(db.identifiers).toHaveLength(1);
  });

  it('treats a differently-shaped form of the same identifier as unchanged', async () => {
    await writeIdentifier(db.client, {
      scheme: 'CIK',
      value: '0000320193',
      entityType: 'company',
      entityId: 'c-1',
      source: 'SEC_EDGAR',
    });
    const outcome = await writeIdentifier(db.client, {
      scheme: 'CIK',
      value: '320193',
      entityType: 'company',
      entityId: 'c-1',
      source: 'SEC_FORM_C',
    });
    expect(outcome).toBe('unchanged');
    expect(db.identifiers).toHaveLength(1);
  });

  it('skips a value that fails validation rather than storing it', async () => {
    // A malformed identifier in the crosswalk would join unrelated entities.
    const outcome = await writeIdentifier(db.client, {
      scheme: 'CIK',
      value: 'name:acme-robotics',
      entityType: 'company',
      entityId: 'c-1',
      source: 'BACKFILL',
    });
    expect(outcome).toBe('skipped');
    expect(db.identifiers).toHaveLength(0);
    expect(db.candidates).toHaveLength(0);
  });

  it('records a candidate instead of overwriting when another entity holds it', async () => {
    await writeIdentifier(db.client, {
      scheme: 'CIK',
      value: '0000320193',
      entityType: 'company',
      entityId: 'c-second',
      source: 'SEC_EDGAR',
    });
    const outcome = await writeIdentifier(db.client, {
      scheme: 'CIK',
      value: '0000320193',
      entityType: 'company',
      entityId: 'c-first',
      source: 'SEC_FORM_C',
    });

    expect(outcome).toBe('conflict');
    // The existing row is untouched: the holder does not change.
    expect(db.identifiers).toHaveLength(1);
    expect(db.identifiers[0]!.entityId).toBe('c-second');

    expect(db.candidates).toHaveLength(1);
    expect(db.candidates[0]).toMatchObject({
      entityType: 'company',
      // Canonically ordered, so the pair is one row whichever way it was found.
      leftId: 'c-first',
      rightId: 'c-second',
      signal: 'identifier',
      evidence: 'CIK:0000320193',
    });
  });

  it('does not create a second candidate for a pair it already proposed', async () => {
    for (const entityId of ['c-a', 'c-b', 'c-b']) {
      await writeIdentifier(db.client, {
        scheme: 'CIK',
        value: '0000320193',
        entityType: 'company',
        entityId,
        source: 'BACKFILL',
      });
    }
    expect(db.candidates).toHaveLength(1);
  });

  it('keeps company and investor identifiers in separate namespaces', async () => {
    // Wefunder is a company row AND an investor row: one organisation that both
    // raises and invests, not a duplicate. Per-type uniqueness is what lets both
    // hold the same CIK.
    expect(
      await writeIdentifier(db.client, {
        scheme: 'CIK',
        value: '0001670254',
        entityType: 'company',
        entityId: 'c-wefunder',
        source: 'BACKFILL',
      }),
    ).toBe('written');
    expect(
      await writeIdentifier(db.client, {
        scheme: 'CIK',
        value: '0001670254',
        entityType: 'investor',
        entityId: 'i-wefunder',
        source: 'BACKFILL',
      }),
    ).toBe('written');
    expect(db.candidates).toHaveLength(0);
  });
});

describe('recordCandidate', () => {
  it('orders the pair canonically however it is called', async () => {
    const db = mockPrisma();
    await recordCandidate(db.client, {
      entityType: 'company',
      aId: 'zeta',
      bId: 'alpha',
      signal: 'domain',
      evidence: 'acme.com',
    });
    expect(db.candidates[0]).toMatchObject({ leftId: 'alpha', rightId: 'zeta' });
  });

  it('ignores a pair of one row with itself', async () => {
    const db = mockPrisma();
    await recordCandidate(db.client, {
      entityType: 'company',
      aId: 'c-1',
      bId: 'c-1',
      signal: 'name',
      evidence: 'acme',
    });
    expect(db.candidates).toHaveLength(0);
  });

  it('upgrades a weak signal to a stronger one', async () => {
    const db = mockPrisma([
      {
        id: 'cand-1',
        entityType: 'company',
        leftId: 'a',
        rightId: 'b',
        signal: 'name',
        evidence: 'acme robotics',
        status: 'PENDING',
      },
    ]);
    await recordCandidate(db.client, {
      entityType: 'company',
      aId: 'a',
      bId: 'b',
      signal: 'identifier',
      evidence: 'CIK:0000320193',
    });
    expect(db.candidates[0]).toMatchObject({
      signal: 'identifier',
      evidence: 'CIK:0000320193',
    });
  });

  it('never downgrades a strong signal to a weaker one', async () => {
    const db = mockPrisma([
      {
        id: 'cand-1',
        entityType: 'company',
        leftId: 'a',
        rightId: 'b',
        signal: 'identifier',
        evidence: 'CIK:0000320193',
        status: 'PENDING',
      },
    ]);
    await recordCandidate(db.client, {
      entityType: 'company',
      aId: 'a',
      bId: 'b',
      signal: 'name',
      evidence: 'acme robotics',
    });
    expect(db.candidates[0]).toMatchObject({
      signal: 'identifier',
      evidence: 'CIK:0000320193',
    });
  });

  it('leaves a decided pair alone, so a rejection is never re-proposed', async () => {
    for (const status of ['REJECTED', 'MERGED']) {
      const db = mockPrisma([
        {
          id: 'cand-1',
          entityType: 'company',
          leftId: 'a',
          rightId: 'b',
          signal: 'name',
          evidence: 'acme robotics',
          status,
        },
      ]);
      await recordCandidate(db.client, {
        entityType: 'company',
        aId: 'a',
        bId: 'b',
        signal: 'identifier',
        evidence: 'CIK:0000320193',
      });
      expect(db.candidates).toHaveLength(1);
      expect(db.candidates[0]).toMatchObject({ signal: 'name', status });
    }
  });
});
