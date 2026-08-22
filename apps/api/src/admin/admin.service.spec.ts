import { describe, it, expect, jest } from '@jest/globals';

import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

/** The Company row applyProposal reads for its before-state. */
function dbCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    slug: 'helia',
    name: 'Helia',
    domain: 'helia.com',
    oneLiner: 'one liner',
    description: 'desc',
    hq: 'SF',
    founded: 2016,
    headcount: 10,
    industry: ['Fintech'],
    status: 'Private',
    stage: 'Series B',
    totalRaisedUsd: 1000n,
    lastValuationUsd: 4000n,
    websiteUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    legalName: null,
    operatingStatus: null,
    companyType: null,
    primarySector: 'Fintech',
    ...overrides,
  };
}

function makePrisma(
  changes: Record<string, unknown>,
  proposal: Record<string, unknown> = {},
  company = dbCompany(),
) {
  const tx = {
    changeProposal: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'p1',
        companyId: 'c1',
        changes,
        note: null,
        sourceUrl: null,
        submittedById: 'u1',
        moderationStatus: 'PENDING',
        company,
        ...proposal,
      })),
      update: jest.fn(async () => ({})),
    },
    company: { update: jest.fn(async () => ({})) },
    revision: {
      create: jest.fn(async () => ({})),
      createMany: jest.fn(async () => ({})),
    },
    source: { upsert: jest.fn(async () => ({ id: 's1' })) },
    citation: { createMany: jest.fn(async () => ({})) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    changeProposal: { update: jest.fn(async () => ({})) },
    company: { update: jest.fn(async () => ({})) },
  };
  return { prisma, tx };
}

/** Prisma double for the child-entity (non-proposal) moderation path. */
function makeRowPrisma(row: Record<string, unknown>) {
  const tx = {
    company: { update: jest.fn(async () => row) },
    fundingRound: { update: jest.fn(async () => row) },
    person: { update: jest.fn(async () => row) },
    investorHolding: {
      update: jest.fn(async () => row),
      findUniqueOrThrow: jest.fn(async () => row),
    },
    investor: { updateMany: jest.fn(async () => ({ count: 1 })) },
    acquisitionDeal: { update: jest.fn(async () => row) },
    exitEvent: { update: jest.fn(async () => row) },
    diversitySignal: { update: jest.fn(async () => row) },
    revision: {
      create: jest.fn(async () => ({})),
      createMany: jest.fn(async () => ({})),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
}

function revisionData(call: unknown): Record<string, unknown> {
  return (call as { data: Record<string, unknown> }).data;
}

describe('AdminService.moderate (proposal)', () => {
  it('approving applies the diff to the company (BigInt money) and flips the proposal', async () => {
    const { prisma, tx } = makePrisma({
      hq: 'Berlin',
      totalRaisedUsd: 5000,
      lastValuationUsd: null,
    });
    const service = new AdminService(prisma as unknown as PrismaService);

    const result = await service.moderate('proposal', 'p1', 'APPROVED', 'admin1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.company.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { hq: 'Berlin', totalRaisedUsd: 5000n, lastValuationUsd: null },
    });
    expect(tx.changeProposal.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { moderationStatus: 'APPROVED' },
    });
    expect(result).toEqual({
      id: 'p1',
      type: 'proposal',
      moderationStatus: 'APPROVED',
    });
  });

  it('records one revision per changed field, with the pre-change value', async () => {
    const { prisma, tx } = makePrisma({ hq: 'Berlin', headcount: 42 });
    const service = new AdminService(prisma as unknown as PrismaService);

    await service.moderate('proposal', 'p1', 'APPROVED', 'admin1');

    const rows = revisionData(tx.revision.createMany.mock.calls[0]![0]) as unknown as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(2);
    expect(rows).toEqual([
      expect.objectContaining({
        companyId: 'c1',
        entityType: 'company',
        entityId: 'c1',
        field: 'hq',
        before: 'SF',
        after: 'Berlin',
        action: 'UPDATE',
        actor: 'ADMIN',
        actorUserId: 'admin1',
        proposalId: 'p1',
      }),
      expect.objectContaining({ field: 'headcount', before: 10, after: 42 }),
    ]);
  });

  it('converts BigInt money columns to numbers on both sides of the diff', async () => {
    const { prisma, tx } = makePrisma({
      totalRaisedUsd: 5000,
      lastValuationUsd: null,
    });
    const service = new AdminService(prisma as unknown as PrismaService);

    await service.moderate('proposal', 'p1', 'APPROVED', 'admin1');

    const rows = revisionData(tx.revision.createMany.mock.calls[0]![0]) as unknown as Record<
      string,
      unknown
    >[];
    // The company row holds BigInt; JSON.stringify would throw on it.
    expect(rows[0]).toMatchObject({
      field: 'totalRaisedUsd',
      before: 1000,
      after: 5000,
    });
    // A field cleared to null stores JsonNull, never bare null (= SQL NULL).
    expect(rows[1]).toMatchObject({ field: 'lastValuationUsd', before: 4000 });
    expect(rows[1]!.after).not.toBeNull();
  });

  it('rejecting only flips the proposal and never touches the company or timeline', async () => {
    const { prisma, tx } = makePrisma({ hq: 'Berlin' });
    const service = new AdminService(prisma as unknown as PrismaService);

    await service.moderate('proposal', 'p1', 'REJECTED', 'admin1');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.company.update).not.toHaveBeenCalled();
    expect(tx.revision.createMany).not.toHaveBeenCalled();
    expect(prisma.company.update).not.toHaveBeenCalled();
    expect(prisma.changeProposal.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { moderationStatus: 'REJECTED' },
    });
  });
});

describe('AdminService.moderate (contributed rows)', () => {
  it('records a CREATE revision when a round is approved', async () => {
    const { prisma, tx } = makeRowPrisma({
      id: 'r1',
      companyId: 'c1',
      name: 'Series B',
      date: new Date('2024-03-01'),
      amountUsd: 75_000_000n,
      postMoneyUsd: null,
      lead: 'Sequoia Capital',
      investors: [],
    });
    const service = new AdminService(prisma as unknown as PrismaService);

    await service.moderate('round', 'r1', 'APPROVED', 'admin1');

    expect(tx.fundingRound.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: { moderationStatus: 'APPROVED' },
      }),
    );
    const data = revisionData(tx.revision.create.mock.calls[0]![0]);
    expect(data).toMatchObject({
      companyId: 'c1',
      entityType: 'round',
      entityId: 'r1',
      field: '',
      action: 'CREATE',
      actor: 'ADMIN',
      actorUserId: 'admin1',
    });
    // The snapshot is the mapped domain object, BigInt money already numeric.
    expect(data.after).toMatchObject({
      name: 'Series B',
      amountUsd: 75_000_000,
    });
  });

  it('anchors an approved company to its own id', async () => {
    const { prisma, tx } = makeRowPrisma(dbCompany());
    const service = new AdminService(prisma as unknown as PrismaService);

    await service.moderate('company', 'c1', 'APPROVED', 'admin1');

    expect(revisionData(tx.revision.create.mock.calls[0]![0])).toMatchObject({
      companyId: 'c1',
      entityType: 'company',
      entityId: 'c1',
    });
  });

  it('publishes the firm an approved holding names', async () => {
    const { prisma, tx } = makeRowPrisma({
      id: 'h1',
      companyId: 'c1',
      investorId: 'i1',
      name: 'Sequoia Capital',
      type: 'Venture',
      firstRound: 'Series B',
      rounds: 2,
      websiteUrl: null,
      linkedinUrl: null,
      investor: { slug: 'sequoia-capital', moderationStatus: 'APPROVED' },
    });
    const service = new AdminService(prisma as unknown as PrismaService);

    await service.moderate('investor', 'h1', 'APPROVED', 'admin1');

    expect(tx.investor.updateMany).toHaveBeenCalledWith({
      where: { id: 'i1', moderationStatus: 'PENDING' },
      data: { moderationStatus: 'APPROVED' },
    });
    expect(revisionData(tx.revision.create.mock.calls[0]![0]).after).toMatchObject({
      slug: 'sequoia-capital',
      name: 'Sequoia Capital',
    });
  });

  it.each(['company', 'round', 'person', 'investor', 'acquisition', 'exit', 'diversity'] as const)(
    'writes no revision when a %s is rejected',
    async (type) => {
      const { prisma, tx } = makeRowPrisma({
        id: 'x1',
        companyId: 'c1',
        investorId: 'i1',
      });
      const service = new AdminService(prisma as unknown as PrismaService);

      await service.moderate(type, 'x1', 'REJECTED', 'admin1');

      expect(tx.revision.create).not.toHaveBeenCalled();
      expect(tx.investor.updateMany).not.toHaveBeenCalled();
    },
  );
});

describe('AdminService.applyProposal (citations)', () => {
  it('mints one citation per changed field from the proposal source URL', async () => {
    const { prisma, tx } = makePrisma(
      { hq: 'Berlin', headcount: 42 },
      { sourceUrl: 'https://example.com/annual-report' },
    );
    const service = new AdminService(prisma as unknown as PrismaService);

    await service.moderate('proposal', 'p1', 'APPROVED', 'admin1');

    expect(tx.source.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { url: 'https://example.com/annual-report' } }),
    );
    const call = tx.citation.createMany.mock.calls[0]![0] as {
      data: Record<string, unknown>[];
      skipDuplicates: boolean;
    };
    expect(call.data).toEqual([
      {
        sourceId: 's1',
        entityType: 'company',
        entityId: 'c1',
        field: 'hq',
        submittedById: 'u1',
      },
      {
        sourceId: 's1',
        entityType: 'company',
        entityId: 'c1',
        field: 'headcount',
        submittedById: 'u1',
      },
    ]);
    // Re-approving the same proposal must not blow up on the unique key.
    expect(call.skipDuplicates).toBe(true);
  });

  it('writes no citation when the proposal cited nothing', async () => {
    const { prisma, tx } = makePrisma({ hq: 'Berlin' });
    const service = new AdminService(prisma as unknown as PrismaService);

    await service.moderate('proposal', 'p1', 'APPROVED', 'admin1');

    expect(tx.source.upsert).not.toHaveBeenCalled();
    expect(tx.citation.createMany).not.toHaveBeenCalled();
  });
});
