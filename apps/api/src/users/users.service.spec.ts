import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const MODELS = [
  'company',
  'fundingRound',
  'personRole',
  'investorHolding',
  'acquisitionDeal',
  'exitEvent',
  'diversitySignal',
  'changeProposal',
] as const;

function prismaWith(findFirsts: Partial<Record<(typeof MODELS)[number], unknown>>) {
  const prisma: Record<string, { findFirst: jest.Mock }> = {};
  for (const m of MODELS) {
    prisma[m] = { findFirst: jest.fn(async () => findFirsts[m] ?? null) };
  }
  return prisma as unknown as PrismaService;
}

const findFirstOf = (prisma: PrismaService, model: (typeof MODELS)[number]) =>
  (prisma as unknown as Record<string, { findFirst: jest.Mock }>)[model]!.findFirst;

describe('UsersService.accessFor (the contribution gate)', () => {
  const DAY = 86_400_000;

  it('is locked for an anonymous viewer, without a query', async () => {
    const prisma = prismaWith({});
    await expect(new UsersService(prisma).accessFor()).resolves.toEqual({
      unlocked: false,
      unlockedUntil: null,
    });
    expect(findFirstOf(prisma, 'company')).not.toHaveBeenCalled();
  });

  it('is unlocked for an admin, without a query', async () => {
    const prisma = prismaWith({});
    const access = await new UsersService(prisma).accessFor({ id: 'a1', role: 'ADMIN' });
    expect(access).toEqual({ unlocked: true, unlockedUntil: null });
    expect(findFirstOf(prisma, 'company')).not.toHaveBeenCalled();
  });

  it('is unlocked inside the window and reports when it lapses', async () => {
    const last = new Date(Date.now() - 5 * DAY);
    const service = new UsersService(prismaWith({ fundingRound: { createdAt: last } }));
    await expect(service.accessFor({ id: 'u1', role: 'USER' })).resolves.toEqual({
      unlocked: true,
      unlockedUntil: new Date(last.getTime() + 30 * DAY).toISOString(),
    });
  });

  it('re-locks after the window but still reports the expiry', async () => {
    const last = new Date(Date.now() - 31 * DAY);
    const service = new UsersService(prismaWith({ personRole: { createdAt: last } }));
    const access = await service.accessFor({ id: 'u1', role: 'USER' });
    expect(access.unlocked).toBe(false);
    expect(access.unlockedUntil).toBe(new Date(last.getTime() + 30 * DAY).toISOString());
  });

  it('is locked for a user who never contributed', async () => {
    const service = new UsersService(prismaWith({}));
    await expect(service.accessFor({ id: 'u1', role: 'USER' })).resolves.toEqual({
      unlocked: false,
      unlockedUntil: null,
    });
  });
});

describe('UsersService.hasRecentContribution', () => {
  let since: Date;

  beforeEach(() => {
    since = new Date(Date.now() - 30 * 86_400_000);
  });

  it('is true when any model has a contribution at/after the cutoff', async () => {
    const service = new UsersService(prismaWith({ fundingRound: { createdAt: new Date() } }));
    await expect(service.hasRecentContribution('u1', since)).resolves.toBe(true);
  });

  it('is false when the only contribution predates the cutoff', async () => {
    const old = new Date(Date.now() - 60 * 86_400_000);
    const service = new UsersService(prismaWith({ personRole: { createdAt: old } }));
    await expect(service.hasRecentContribution('u1', since)).resolves.toBe(false);
  });

  it('is false when the user has no contributions at all', async () => {
    const service = new UsersService(prismaWith({}));
    await expect(service.hasRecentContribution('u1', since)).resolves.toBe(false);
  });

  it('counts an edit proposal as a contribution', async () => {
    const service = new UsersService(prismaWith({ changeProposal: { createdAt: new Date() } }));
    await expect(service.hasRecentContribution('u1', since)).resolves.toBe(true);
  });

  it('only counts APPROVED contributions, on every model', async () => {
    const prisma = prismaWith({});
    await new UsersService(prisma).hasRecentContribution('u1', since);
    for (const m of MODELS) {
      const { findFirst } = (
        prisma as unknown as Record<(typeof MODELS)[number], { findFirst: jest.Mock }>
      )[m];
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { submittedById: 'u1', moderationStatus: 'APPROVED' },
        }),
      );
    }
  });
});

type SavedRow = { createdAt: Date; company: Record<string, unknown> };

function watchlistPrisma(overrides: {
  company?: { id: string } | null;
  savedRows?: SavedRow[];
  savedCount?: number;
}) {
  const prisma = {
    company: {
      findFirst: jest.fn<(args: unknown) => Promise<{ id: string } | null>>(
        async () => overrides.company ?? null,
      ),
    },
    savedCompany: {
      findMany: jest.fn<(args: unknown) => Promise<SavedRow[]>>(
        async () => overrides.savedRows ?? [],
      ),
      upsert: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
      deleteMany: jest.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({
        count: 0,
      })),
      count: jest.fn<(args: unknown) => Promise<number>>(async () => overrides.savedCount ?? 0),
    },
  };
  return { prisma, service: new UsersService(prisma as unknown as PrismaService) };
}

describe('UsersService saved companies', () => {
  it('saveCompany rejects an unknown or unapproved slug', async () => {
    const { prisma, service } = watchlistPrisma({ company: null });
    await expect(service.saveCompany('u1', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.savedCompany.upsert).not.toHaveBeenCalled();
  });

  it('saveCompany upserts on the compound key so double-saving keeps one row', async () => {
    const { prisma, service } = watchlistPrisma({ company: { id: 'c1' } });
    await expect(service.saveCompany('u1', 'acme')).resolves.toEqual({ saved: true });
    await expect(service.saveCompany('u1', 'acme')).resolves.toEqual({ saved: true });
    expect(prisma.savedCompany.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.savedCompany.upsert).toHaveBeenCalledWith({
      where: { userId_companyId: { userId: 'u1', companyId: 'c1' } },
      create: { userId: 'u1', companyId: 'c1' },
      update: {},
    });
  });

  it('unsaveCompany is idempotent when nothing is saved', async () => {
    const { service } = watchlistPrisma({});
    await expect(service.unsaveCompany('u1', 'acme')).resolves.toEqual({ saved: false });
  });

  it('isCompanySaved reflects the row count', async () => {
    const { service: without } = watchlistPrisma({ savedCount: 0 });
    await expect(without.isCompanySaved('u1', 'acme')).resolves.toBe(false);
    const { service: withRow } = watchlistPrisma({ savedCount: 1 });
    await expect(withRow.isCompanySaved('u1', 'acme')).resolves.toBe(true);
  });

  it('listSavedCompanies maps BigInt totals and queries only APPROVED companies', async () => {
    const { prisma, service } = watchlistPrisma({
      savedRows: [
        {
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          company: {
            slug: 'acme',
            name: 'Acme',
            domain: 'acme.com',
            oneLiner: 'Anvils as a service.',
            stage: 'Series A',
            totalRaisedUsd: 12_000_000n,
          },
        },
      ],
    });
    await expect(service.listSavedCompanies('u1')).resolves.toEqual([
      {
        slug: 'acme',
        name: 'Acme',
        domain: 'acme.com',
        oneLiner: 'Anvils as a service.',
        stage: 'Series A',
        totalRaisedUsd: 12_000_000,
        savedAt: '2026-07-01T00:00:00.000Z',
      },
    ]);
    expect(prisma.savedCompany.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // Approved AND not merged away — a tombstoned company is invisible
        // on a watchlist too.
        where: {
          userId: 'u1',
          company: { moderationStatus: 'APPROVED', mergedIntoId: null },
        },
      }),
    );
  });
});
