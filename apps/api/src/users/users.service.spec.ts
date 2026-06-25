import { describe, it, expect, jest, beforeEach } from '@jest/globals';

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
});
