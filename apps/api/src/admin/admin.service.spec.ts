import { describe, it, expect, jest } from '@jest/globals';

import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

function makePrisma(changes: Record<string, unknown>) {
  const tx = {
    changeProposal: {
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'p1',
        companyId: 'c1',
        changes,
        note: null,
        moderationStatus: 'PENDING',
      })),
      update: jest.fn(async () => ({})),
    },
    company: { update: jest.fn(async () => ({})) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    changeProposal: { update: jest.fn(async () => ({})) },
    company: { update: jest.fn(async () => ({})) },
  };
  return { prisma, tx };
}

describe('AdminService.moderate (proposal)', () => {
  it('approving applies the diff to the company (BigInt money) and flips the proposal', async () => {
    const { prisma, tx } = makePrisma({ hq: 'Berlin', totalRaisedUsd: 5000, lastValuationUsd: null });
    const service = new AdminService(prisma as unknown as PrismaService);

    const result = await service.moderate('proposal', 'p1', 'APPROVED');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.company.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { hq: 'Berlin', totalRaisedUsd: 5000n, lastValuationUsd: null },
    });
    expect(tx.changeProposal.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { moderationStatus: 'APPROVED' },
    });
    expect(result).toEqual({ id: 'p1', type: 'proposal', moderationStatus: 'APPROVED' });
  });

  it('rejecting only flips the proposal and never touches the company', async () => {
    const { prisma, tx } = makePrisma({ hq: 'Berlin' });
    const service = new AdminService(prisma as unknown as PrismaService);

    await service.moderate('proposal', 'p1', 'REJECTED');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.company.update).not.toHaveBeenCalled();
    expect(prisma.company.update).not.toHaveBeenCalled();
    expect(prisma.changeProposal.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { moderationStatus: 'REJECTED' },
    });
  });
});
