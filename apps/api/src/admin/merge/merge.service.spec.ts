import type { PrismaService } from '../../prisma/prisma.service';
import { MergeService } from './merge.service';

type Row = Record<string, unknown> & { id: string };

/**
 * A tiny in-memory Prisma stand-in.
 *
 * Enough of the real semantics to make the assertions mean something: rows are
 * mutated in place, so a round-trip test genuinely compares before and after
 * state rather than counting mock calls.
 */
function table(rows: Row[] = []) {
  const match = (row: Row, where: Record<string, unknown> = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v !== null && typeof v === 'object' && 'in' in (v as object)) {
        return ((v as { in: unknown[] }).in ?? []).includes(row[k]);
      }
      return row[k] === v;
    });

  return {
    rows,
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((r) => match(r, where)) ?? null,
    findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.find((r) => match(r, where)) ?? null,
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.filter((r) => match(r, where)).map((r) => ({ ...r })),
    updateMany: async ({
      where,
      data,
    }: {
      where?: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const r of rows) {
        if (match(r, where)) {
          Object.assign(r, data);
          count++;
        }
      }
      return { count };
    },
    update: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const r = rows.find((x) => match(x, where));
      if (!r) throw new Error('not found');
      Object.assign(r, data);
      return { ...r };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: data.id ?? `gen-${rows.length + 1}`, ...data } as Row;
      rows.push(row);
      return { ...row };
    },
    delete: async ({ where }: { where: Record<string, unknown> }) => {
      const i = rows.findIndex((r) => match(r, where));
      if (i < 0) throw new Error('not found');
      return rows.splice(i, 1)[0]!;
    },
    groupBy: async () => [],
  };
}

function fixture() {
  const db = {
    company: table([
      { id: 'c-keep', slug: 'acme', name: 'Acme, Inc.', mergedIntoId: null, createdAt: new Date() },
      { id: 'c-lose', slug: 'acme-inc', name: 'Acme Inc', mergedIntoId: null, createdAt: new Date() },
    ]),
    investor: table([
      { id: 'i-keep', slug: 'big', name: 'Big Fund', mergedIntoId: null, createdAt: new Date() },
      { id: 'i-lose', slug: 'big-2', name: 'Big Fund LP', mergedIntoId: null, createdAt: new Date() },
    ]),
    fundingRound: table([
      { id: 'r-1', companyId: 'c-lose' },
      { id: 'r-2', companyId: 'c-keep' },
    ]),
    person: table([{ id: 'p-1', companyId: 'c-lose' }]),
    investorHolding: table([{ id: 'h-1', companyId: 'c-lose', investorId: 'i-lose' }]),
    acquisitionDeal: table([{ id: 'a-1', companyId: 'c-lose' }]),
    exitEvent: table([{ id: 'e-1', companyId: 'c-lose' }]),
    diversitySignal: table([{ id: 'd-1', companyId: 'c-lose' }]),
    changeProposal: table([{ id: 'pr-1', companyId: 'c-lose' }]),
    roundInvestor: table([{ id: 'ri-1', investorId: 'i-lose' }]),
    fund: table([{ id: 'f-1', managerId: 'i-lose' }]),
    savedCompany: table([
      // u-both saved BOTH rows: the collision case.
      { id: 's-1', userId: 'u-both', companyId: 'c-lose', createdAt: new Date('2026-01-01') },
      { id: 's-2', userId: 'u-both', companyId: 'c-keep', createdAt: new Date('2026-01-01') },
      { id: 's-3', userId: 'u-only-loser', companyId: 'c-lose', createdAt: new Date('2026-01-02') },
    ]),
    revision: table([
      { id: 'rev-1', companyId: 'c-lose', entityType: 'company', entityId: 'c-lose', field: '' },
      { id: 'rev-2', companyId: 'c-lose', entityType: 'round', entityId: 'r-1', field: 'amountUsd' },
    ]),
    citation: table([
      // Same source AND same field on both rows: collides on the remap.
      {
        id: 'cit-dup',
        sourceId: 'src-1',
        entityType: 'company',
        entityId: 'c-lose',
        field: '',
        note: null,
        submittedById: null,
        createdAt: new Date('2026-02-01'),
      },
      {
        id: 'cit-keep',
        sourceId: 'src-1',
        entityType: 'company',
        entityId: 'c-keep',
        field: '',
        note: null,
        submittedById: null,
        createdAt: new Date('2026-02-01'),
      },
      {
        id: 'cit-move',
        sourceId: 'src-2',
        entityType: 'company',
        entityId: 'c-lose',
        field: 'hq',
        note: null,
        submittedById: null,
        createdAt: new Date('2026-02-01'),
      },
      // A holding's citation. entityType 'investor' is overloaded — this one
      // anchors to an InvestorHolding, not to the firm — so an investor merge
      // must leave it alone.
      {
        id: 'cit-holding',
        sourceId: 'src-3',
        entityType: 'investor',
        entityId: 'h-1',
        field: '',
        note: null,
        submittedById: null,
        createdAt: new Date('2026-02-01'),
      },
    ]),
    entityIdentifier: table([
      {
        id: 'ei-dup',
        scheme: 'CIK',
        value: '0000000123',
        entityType: 'company',
        entityId: 'c-lose',
        source: 'SEC_FORM_C',
        createdAt: new Date('2026-03-01'),
      },
      {
        id: 'ei-keep',
        scheme: 'CIK',
        value: '0000000123',
        entityType: 'company',
        entityId: 'c-keep',
        source: 'SEC_EDGAR',
        createdAt: new Date('2026-03-01'),
      },
      {
        id: 'ei-move',
        scheme: 'DOMAIN',
        value: 'acme.com',
        entityType: 'company',
        entityId: 'c-lose',
        source: 'BACKFILL',
        createdAt: new Date('2026-03-01'),
      },
      {
        id: 'ei-inv',
        scheme: 'CRD',
        value: '123456',
        entityType: 'investor',
        entityId: 'i-lose',
        source: 'SEC_ADV',
        createdAt: new Date('2026-03-01'),
      },
    ]),
    mergeCandidate: table([
      {
        id: 'cand-1',
        entityType: 'company',
        leftId: 'c-keep',
        rightId: 'c-lose',
        signal: 'identifier',
        evidence: 'CIK:0000000123',
        status: 'PENDING',
        decidedAt: null,
        decidedById: null,
        createdAt: new Date(),
      },
    ]),
    mergeRecord: table([]),
  };

  const prisma = {
    ...db,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  return { db, service: new MergeService(prisma as unknown as PrismaService) };
}

/** Every owning-FK value in the database, so a round trip can be asserted as a
 *  whole rather than table by table. */
function snapshot(db: ReturnType<typeof fixture>['db']) {
  const of = (t: { rows: Row[] }, key: string) =>
    t.rows.map((r) => `${r.id}:${String(r[key])}`).sort();

  return {
    rounds: of(db.fundingRound, 'companyId'),
    people: of(db.person, 'companyId'),
    holdings: of(db.investorHolding, 'companyId'),
    acquisitions: of(db.acquisitionDeal, 'companyId'),
    exits: of(db.exitEvent, 'companyId'),
    diversity: of(db.diversitySignal, 'companyId'),
    proposals: of(db.changeProposal, 'companyId'),
    saves: db.savedCompany.rows.map((r) => `${String(r.userId)}:${String(r.companyId)}`).sort(),
    // The MERGE/UNMERGE entries the operations write about THEMSELVES are
    // deliberately not reversed — they are the audit trail for both directions
    // — so they are excluded from the round-trip comparison and asserted
    // separately.
    revisionCompanies: db.revision.rows
      .filter((r) => r.action !== 'MERGE' && r.action !== 'UNMERGE')
      .map((r) => `${r.id}:${String(r.companyId)}`)
      .sort(),
    citations: db.citation.rows.map((r) => `${String(r.sourceId)}:${String(r.entityId)}:${String(r.field)}`).sort(),
    identifiers: db.entityIdentifier.rows
      .map((r) => `${String(r.scheme)}:${String(r.value)}:${String(r.entityId)}`)
      .sort(),
  };
}

describe('MergeService company merge', () => {
  it('moves every child table onto the survivor', async () => {
    const { db, service } = fixture();
    await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');

    for (const t of [
      db.fundingRound,
      db.person,
      db.investorHolding,
      db.acquisitionDeal,
      db.exitEvent,
      db.diversitySignal,
      db.changeProposal,
    ]) {
      expect(t.rows.every((r) => r.companyId === 'c-keep')).toBe(true);
    }
  });

  it('tombstones the loser instead of deleting it', async () => {
    // Deleting it would free its (externalSource, externalId) and the next
    // ingest run would recreate the duplicate.
    const { db, service } = fixture();
    await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');

    expect(db.company.rows).toHaveLength(2);
    expect(db.company.rows.find((r) => r.id === 'c-lose')!.mergedIntoId).toBe('c-keep');
  });

  it('deletes the SavedCompany that would collide and keeps the one that would not', async () => {
    const { db, service } = fixture();
    await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');

    const pairs = db.savedCompany.rows.map((r) => `${String(r.userId)}:${String(r.companyId)}`);
    // u-both ends with exactly one row, not two.
    expect(pairs.filter((p) => p === 'u-both:c-keep')).toHaveLength(1);
    expect(pairs).toContain('u-only-loser:c-keep');
  });

  it('deletes the colliding citation and moves the rest', async () => {
    const { db, service } = fixture();
    await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');

    expect(db.citation.rows.find((r) => r.id === 'cit-dup')).toBeUndefined();
    expect(db.citation.rows.find((r) => r.id === 'cit-move')!.entityId).toBe('c-keep');
    expect(db.citation.rows.find((r) => r.id === 'cit-keep')).toBeDefined();
  });

  it('deletes the identifier the survivor already holds and moves the rest', async () => {
    const { db, service } = fixture();
    await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');

    // The very identifier that proposed the pair.
    expect(db.entityIdentifier.rows.find((r) => r.id === 'ei-dup')).toBeUndefined();
    expect(db.entityIdentifier.rows.find((r) => r.id === 'ei-move')!.entityId).toBe('c-keep');
  });

  it('repoints revisions, including a company revision that anchors to itself', async () => {
    const { db, service } = fixture();
    await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');

    const rev1 = db.revision.rows.find((r) => r.id === 'rev-1')!;
    expect(rev1.companyId).toBe('c-keep');
    expect(rev1.entityId).toBe('c-keep');
    expect(db.revision.rows.find((r) => r.id === 'rev-2')!.companyId).toBe('c-keep');
  });

  it('writes one MERGE entry on the survivor timeline, with no field diff', async () => {
    const { db, service } = fixture();
    await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');

    const entry = db.revision.rows.find((r) => r.action === 'MERGE')!;
    expect(entry).toMatchObject({ companyId: 'c-keep', entityId: 'c-keep', field: '', actor: 'ADMIN' });
    expect(entry.before).toMatchObject({ name: 'Acme Inc' });
  });

  it('marks the candidate MERGED and records who did it', async () => {
    const { db, service } = fixture();
    const { mergeRecordId } = await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');

    expect(db.mergeCandidate.rows[0]!.status).toBe('MERGED');
    expect(db.mergeRecord.rows.find((r) => r.id === mergeRecordId)).toMatchObject({
      survivorId: 'c-keep',
      losingId: 'c-lose',
      mergedById: 'admin-1',
    });
  });

  it('refuses a survivor that is not one of the pair', async () => {
    const { service } = fixture();
    await expect(service.mergeCandidate('cand-1', 'c-other', 'admin-1')).rejects.toThrow(
      /must be one of the pair/,
    );
  });

  it('refuses to merge a row that has already been merged away', async () => {
    const { db, service } = fixture();
    db.company.rows.find((r) => r.id === 'c-lose')!.mergedIntoId = 'c-keep';
    await expect(service.merge('company', 'c-keep', 'c-lose', 'admin-1')).rejects.toThrow(
      /already been merged away/,
    );
  });

  it('refuses to merge a row into itself', async () => {
    const { service } = fixture();
    await expect(service.merge('company', 'c-keep', 'c-keep', 'admin-1')).rejects.toThrow(
      /into itself/,
    );
  });

  it('refuses a candidate that was already decided', async () => {
    const { db, service } = fixture();
    db.mergeCandidate.rows[0]!.status = 'REJECTED';
    await expect(service.mergeCandidate('cand-1', 'c-keep', 'admin-1')).rejects.toThrow(
      /already REJECTED/,
    );
  });
});

describe('MergeService unmerge', () => {
  it('restores every table to its pre-merge state', async () => {
    const { db, service } = fixture();
    const before = snapshot(db);

    const { mergeRecordId } = await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');
    expect(snapshot(db)).not.toEqual(before);

    await service.unmerge(mergeRecordId, 'admin-1');

    // The deleted rows were recreated from their recorded content, not moved
    // back — which is why `moved` stores more than ids for those.
    expect(snapshot(db)).toEqual(before);
  });

  it('clears the tombstone and reopens the candidate', async () => {
    const { db, service } = fixture();
    const { mergeRecordId } = await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');
    await service.unmerge(mergeRecordId, 'admin-1');

    expect(db.company.rows.find((r) => r.id === 'c-lose')!.mergedIntoId).toBeNull();
    expect(db.mergeCandidate.rows[0]!.status).toBe('PENDING');
    expect(db.mergeRecord.rows[0]!.unmergedAt).toBeTruthy();
  });

  it('writes an UNMERGE entry on the timeline', async () => {
    const { db, service } = fixture();
    const { mergeRecordId } = await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');
    await service.unmerge(mergeRecordId, 'admin-1');

    expect(db.revision.rows.some((r) => r.action === 'UNMERGE')).toBe(true);
  });

  it('refuses twice', async () => {
    const { service } = fixture();
    const { mergeRecordId } = await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');
    await service.unmerge(mergeRecordId, 'admin-1');
    await expect(service.unmerge(mergeRecordId, 'admin-1')).rejects.toThrow(/already been reversed/);
  });

  it('refuses when the survivor has itself been merged away', async () => {
    // The state it would restore no longer exists.
    const { db, service } = fixture();
    const { mergeRecordId } = await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');
    db.company.rows.find((r) => r.id === 'c-keep')!.mergedIntoId = 'c-third';

    await expect(service.unmerge(mergeRecordId, 'admin-1')).rejects.toThrow(
      /survivor has since been merged away/,
    );
  });
});

describe('MergeService investor merge', () => {
  it('repoints holdings, round positions and funds', async () => {
    const { db, service } = fixture();
    await service.merge('investor', 'i-keep', 'i-lose', 'admin-1');

    expect(db.investorHolding.rows[0]!.investorId).toBe('i-keep');
    expect(db.roundInvestor.rows[0]!.investorId).toBe('i-keep');
    expect(db.fund.rows[0]!.managerId).toBe('i-keep');
  });

  it("moves the firm's own identifiers", async () => {
    const { db, service } = fixture();
    await service.merge('investor', 'i-keep', 'i-lose', 'admin-1');

    expect(db.entityIdentifier.rows.find((r) => r.id === 'ei-inv')!.entityId).toBe('i-keep');
  });

  it("leaves a holding's citation alone, despite the shared entityType", async () => {
    // `entityType: 'investor'` means the firm in the citation backfill and the
    // holding in moderation. Filtering on entityId is what keeps them apart.
    const { db, service } = fixture();
    await service.merge('investor', 'i-keep', 'i-lose', 'admin-1');

    expect(db.citation.rows.find((r) => r.id === 'cit-holding')!.entityId).toBe('h-1');
  });

  it('writes no revision — a firm has no company to anchor a timeline to', async () => {
    const { db, service } = fixture();
    const before = db.revision.rows.length;
    await service.merge('investor', 'i-keep', 'i-lose', 'admin-1');
    expect(db.revision.rows).toHaveLength(before);
  });

  it('tombstones the losing firm', async () => {
    const { db, service } = fixture();
    await service.merge('investor', 'i-keep', 'i-lose', 'admin-1');
    expect(db.investor.rows.find((r) => r.id === 'i-lose')!.mergedIntoId).toBe('i-keep');
  });

  it('round-trips through unmerge', async () => {
    const { db, service } = fixture();
    const before = snapshot(db);
    const { mergeRecordId } = await service.merge('investor', 'i-keep', 'i-lose', 'admin-1');
    await service.unmerge(mergeRecordId, 'admin-1');

    expect(db.investorHolding.rows[0]!.investorId).toBe('i-lose');
    expect(db.fund.rows[0]!.managerId).toBe('i-lose');
    expect(snapshot(db)).toEqual(before);
  });
});

describe('MergeService reject', () => {
  it('keeps the pair as REJECTED so no detector re-proposes it', async () => {
    const { db, service } = fixture();
    await service.reject('cand-1', 'admin-1');

    expect(db.mergeCandidate.rows).toHaveLength(1);
    expect(db.mergeCandidate.rows[0]).toMatchObject({ status: 'REJECTED', decidedById: 'admin-1' });
  });

  it('refuses to reject a pair that was merged', async () => {
    const { service } = fixture();
    await service.mergeCandidate('cand-1', 'c-keep', 'admin-1');
    await expect(service.reject('cand-1', 'admin-1')).rejects.toThrow(/unmerge it before rejecting/);
  });
});
