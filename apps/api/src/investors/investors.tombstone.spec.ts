import { HttpException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service';
import { InvestorsService } from './investors.service';

/** A merged-away investor keeps its slug: the old address redirects, and the
 *  row is gone from every public list. */
function serviceWith(
  rows: { id: string; slug: string; mergedIntoId: string | null; moderationStatus?: string }[],
) {
  const live = (slug: string) =>
    rows.find(
      (r) =>
        r.slug === slug &&
        r.mergedIntoId === null &&
        (r.moderationStatus ?? 'APPROVED') === 'APPROVED',
    );

  const prisma = {
    investor: {
      findFirst: jest.fn(async ({ where }: { where: { slug: string } }) => {
        const row = live(where.slug);
        return row
          ? { ...row, name: 'X', type: 'Venture', holdings: [], funds: [], _count: { holdings: 0, funds: 0 } }
          : null;
      }),
      findUnique: jest.fn(async ({ where }: { where: { slug?: string; id?: string } }) => {
        const row = where.slug
          ? rows.find((r) => r.slug === where.slug)
          : rows.find((r) => r.id === where.id);
        return row ? { ...row, moderationStatus: row.moderationStatus ?? 'APPROVED' } : null;
      }),
      findMany: jest.fn(async () =>
        rows
          .filter((r) => r.mergedIntoId === null)
          .map((r) => ({ ...r, updatedAt: new Date('2026-09-01T00:00:00.000Z') })),
      ),
    },
    citation: { findMany: jest.fn(async () => []) },
    entityIdentifier: { findMany: jest.fn(async () => []) },
  } as unknown as PrismaService;

  return new InvestorsService(prisma);
}

async function statusOf(fn: () => Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
    throw new Error('expected a throw');
  } catch (err) {
    if (err instanceof HttpException) return { status: err.getStatus(), body: err.getResponse() };
    throw err;
  }
}

describe('InvestorsService tombstones', () => {
  it('answers 301 with the survivor slug in the body', async () => {
    const service = serviceWith([
      { id: 'i-lose', slug: 'big-old', mergedIntoId: 'i-keep' },
      { id: 'i-keep', slug: 'big', mergedIntoId: null },
    ]);
    const { status, body } = await statusOf(() => service.findOne('big-old'));
    expect(status).toBe(301);
    expect(body).toMatchObject({ redirectTo: 'big' });
  });

  it('follows a chain and terminates on a cycle', async () => {
    const chain = serviceWith([
      { id: 'i-1', slug: 'a', mergedIntoId: 'i-2' },
      { id: 'i-2', slug: 'b', mergedIntoId: 'i-3' },
      { id: 'i-3', slug: 'c', mergedIntoId: null },
    ]);
    expect((await statusOf(() => chain.findOne('a'))).body).toMatchObject({ redirectTo: 'c' });

    const cycle = serviceWith([
      { id: 'i-1', slug: 'a', mergedIntoId: 'i-2' },
      { id: 'i-2', slug: 'b', mergedIntoId: 'i-1' },
    ]);
    expect((await statusOf(() => cycle.findOne('a'))).status).toBe(404);
  });

  it('404s for an unknown slug', async () => {
    const { status } = await statusOf(() =>
      serviceWith([{ id: 'i-1', slug: 'big', mergedIntoId: null }]).findOne('nope'),
    );
    expect(status).toBe(404);
  });

  it('drops tombstones from the sitemap feed', async () => {
    const service = serviceWith([
      { id: 'i-lose', slug: 'big-old', mergedIntoId: 'i-keep' },
      { id: 'i-keep', slug: 'big', mergedIntoId: null },
    ]);
    expect((await service.listSlugs()).map((s) => s.slug)).toEqual(['big']);
  });
});
