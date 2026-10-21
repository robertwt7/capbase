import { describe, it, expect, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { ApiKeysService } from '../../api-keys/api-keys.service';
import { SecurityEvent } from '../../auth/mfa/mfa.service';
import { MfaPolicy } from '../../auth/mfa/policy';
import type { MailService } from '../../mail/mail.service';
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
  'investorChangeProposal',
] as const;

const baseUser = {
  id: 'u1',
  email: 'u@test.dev',
  name: 'U',
  role: 'USER' as 'USER' | 'CONTRIBUTOR' | 'ADMIN',
  bannedAt: null as Date | null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  mfaEnabledAt: null as Date | null,
};

function prismaFor(existing: typeof baseUser | null) {
  const tx: Record<string, unknown> = {
    user: {
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        ...baseUser,
        ...(existing ?? {}),
        ...args.data,
      })),
    },
    apiKey: { updateMany: jest.fn(async () => ({ count: 0 })) },
    webAuthnCredential: { deleteMany: jest.fn(async () => ({ count: 2 })) },
    recoveryCode: { deleteMany: jest.fn(async () => ({ count: 10 })) },
    authChallenge: { deleteMany: jest.fn(async () => ({ count: 1 })) },
  };
  for (const m of CONTRIBUTABLE) tx[m] = { updateMany: jest.fn(async () => ({ count: 0 })) };
  const prisma = {
    user: { findUnique: jest.fn(async () => existing) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    $queryRaw: jest.fn(async () => [{ id: 'u1', n: 3 }]),
  };
  return { prisma: prisma as unknown as PrismaService, tx };
}

const mail = { sendSecurityNotice: jest.fn(async () => undefined) };
const serviceFor = (prisma: PrismaService) =>
  new AdminUsersService(
    prisma,
    new ApiKeysService(prisma, new MfaPolicy(new ConfigService({}))),
    mail as unknown as MailService,
  );

type Mocked = { updateMany: jest.Mock };
const keyRevocations = (tx: Record<string, unknown>) =>
  ((tx.apiKey as Mocked).updateMany.mock.calls as unknown[][]).map(
    (c) => (c[0] as { where: Record<string, unknown> }).where,
  );
type UserTx = { user: { update: jest.Mock } };

describe('AdminUsersService.update', () => {
  it('bans: stamps bannedAt, revokes sessions and rejects every pending row', async () => {
    const { prisma, tx } = prismaFor(baseUser);
    const result = await serviceFor(prisma).update('u1', { banned: true }, 'admin');

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
    await serviceFor(prisma).update('u1', { banned: false }, 'admin');

    const { data } = (tx as UserTx).user.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data).toEqual({ bannedAt: null });
    expect((tx.company as Mocked).updateMany).not.toHaveBeenCalled();
  });

  it('changes role on its own', async () => {
    const { prisma, tx } = prismaFor(baseUser);
    await serviceFor(prisma).update('u1', { role: 'ADMIN' }, 'admin');
    const { data } = (tx as UserTx).user.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data).toEqual({ role: 'ADMIN' });
  });

  it('refuses to let an admin ban or demote themselves', async () => {
    const { prisma } = prismaFor(baseUser);
    const service = serviceFor(prisma);
    await expect(service.update('u1', { banned: true }, 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.update('u1', { role: 'USER' }, 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses self-demotion to contributor too', async () => {
    const { prisma } = prismaFor({ ...baseUser, role: 'ADMIN' });
    await expect(
      serviceFor(prisma).update('u1', { role: 'CONTRIBUTOR' }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revokes every API key on a demotion to USER', async () => {
    const { prisma, tx } = prismaFor({ ...baseUser, role: 'CONTRIBUTOR' });
    await serviceFor(prisma).update('u1', { role: 'USER' }, 'admin');
    expect(keyRevocations(tx)).toEqual([{ userId: 'u1', revokedAt: null }]);
  });

  it('revokes only admin keys on ADMIN → CONTRIBUTOR', async () => {
    const { prisma, tx } = prismaFor({ ...baseUser, role: 'ADMIN' });
    await serviceFor(prisma).update('u1', { role: 'CONTRIBUTOR' }, 'admin');
    expect(keyRevocations(tx)).toEqual([
      { userId: 'u1', revokedAt: null, scope: { notIn: ['contributor'] } },
    ]);
  });

  it('revokes nothing when promoting to ADMIN', async () => {
    const { prisma, tx } = prismaFor({ ...baseUser, role: 'CONTRIBUTOR' });
    await serviceFor(prisma).update('u1', { role: 'ADMIN' }, 'admin');
    expect(keyRevocations(tx)).toEqual([]);
  });

  it('revokes every API key on a ban, whatever the role', async () => {
    const { prisma, tx } = prismaFor({ ...baseUser, role: 'ADMIN' });
    await serviceFor(prisma).update('u1', { banned: true }, 'admin');
    expect(keyRevocations(tx)).toEqual([{ userId: 'u1', revokedAt: null }]);
  });

  it('404s an unknown user', async () => {
    const { prisma } = prismaFor(null);
    await expect(
      serviceFor(prisma).update('nope', { banned: true }, 'admin'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminUsersService.resetMfa', () => {
  it('refuses to reset your own account', async () => {
    const { prisma, tx } = prismaFor(baseUser);
    await expect(serviceFor(prisma).resetMfa('u1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect((tx as UserTx).user.update).not.toHaveBeenCalled();
  });

  it('clears every factor, revokes sessions and emails the user', async () => {
    const { prisma, tx } = prismaFor({ ...baseUser, mfaEnabledAt: new Date() });
    const result = await serviceFor(prisma).resetMfa('u1', 'admin');
    const t = tx as unknown as Record<string, { deleteMany: jest.Mock }>;
    for (const m of ['webAuthnCredential', 'recoveryCode', 'authChallenge']) {
      expect(t[m]!.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    }
    const { data } = (tx as UserTx).user.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data).toEqual({
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      mfaEnabledAt: null,
      tokenVersion: { increment: 1 },
    });
    expect(result.mfaEnabled).toBe(false);
    expect(mail.sendSecurityNotice).toHaveBeenCalledWith('u@test.dev', 'U', SecurityEvent.adminReset);
  });

  it('404s an unknown user', async () => {
    const { prisma } = prismaFor(null);
    await expect(serviceFor(prisma).resetMfa('nope', 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });
});
