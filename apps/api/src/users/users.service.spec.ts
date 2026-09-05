import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const MODELS = [
  'company',
  'fundingRound',
  'person',
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
    const service = new UsersService(prismaWith({ person: { createdAt: old } }));
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
