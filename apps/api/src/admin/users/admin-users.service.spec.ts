import { describe, it, expect, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service';
import { AdminUsersService } from './admin-users.service';

const CONTRIBUTABLE = [
  'company',
  'fundingRound',
  'personRole',
  'investorHolding',
  'acquisitionDeal',
  'exitEvent',
  'diversitySignal',
  'changeProposal',
] as const;

const baseUser = {
  id: 'u1',
  email: 'u@test.dev',
  name: 'U',
  role: 'USER' as const,
  bannedAt: null as Date | null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function prismaFor(existing: typeof baseUser | null) {
  const tx: Record<string, unknown> = {
    user: {
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        ...baseUser,
        ...args.data,
      })),
    },
  };
  for (const m of CONTRIBUTABLE) tx[m] = { updateMany: jest.fn(async () => ({ count: 0 })) };
  const prisma = {
    user: { findUnique: jest.fn(async () => existing) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    $queryRaw: jest.fn(async () => [{ id: 'u1', n: 3 }]),
  };
  return { prisma: prisma as unknown as PrismaService, tx };
}

type Mocked = { updateMany: jest.Mock };
type UserTx = { user: { update: jest.Mock } };

describe('AdminUsersService.update', () => {
  it('bans: stamps bannedAt, revokes sessions and rejects every pending row', async () => {
    const { prisma, tx } = prismaFor(baseUser);
    const result = await new AdminUsersService(prisma).update('u1', { banned: true }, 'admin');

    const { data } = (tx as UserTx).user.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data.bannedAt).toBeInstanceOf(Date);
    expect(data.tokenVersion).toEqual({ increment: 1 });
    for (const m of CONTRIBUTABLE) {
      expect((tx[m] as Mocked).updateMany).toHaveBeenCalledWith({
        where: { submittedById: 'u1', moderationStatus: 'PENDING' },
        data: { moderationStatus: 'REJECTED' },
      });
    }
    expect(result.pendingCount).toBe(3);
  });

  it('unbans without touching submissions or sessions', async () => {
    const { prisma, tx } = prismaFor({ ...baseUser, bannedAt: new Date() });
    await new AdminUsersService(prisma).update('u1', { banned: false }, 'admin');

    const { data } = (tx as UserTx).user.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data).toEqual({ bannedAt: null });
    expect((tx.company as Mocked).updateMany).not.toHaveBeenCalled();
  });

  it('changes role on its own', async () => {
    const { prisma, tx } = prismaFor(baseUser);
    await new AdminUsersService(prisma).update('u1', { role: 'ADMIN' }, 'admin');
    const { data } = (tx as UserTx).user.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data).toEqual({ role: 'ADMIN' });
  });

  it('refuses to let an admin ban or demote themselves', async () => {
    const { prisma } = prismaFor(baseUser);
    const service = new AdminUsersService(prisma);
    await expect(service.update('u1', { banned: true }, 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.update('u1', { role: 'USER' }, 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s an unknown user', async () => {
    const { prisma } = prismaFor(null);
    await expect(
      new AdminUsersService(prisma).update('nope', { banned: true }, 'admin'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
