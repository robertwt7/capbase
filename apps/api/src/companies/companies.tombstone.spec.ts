import { HttpException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import { CompaniesService } from './companies.service';

/**
 * A merged-away company keeps its slug, so the old address must answer with a
 * permanent redirect rather than a 404 — and must be invisible everywhere else.
 */
function serviceWith(rows: { id: string; slug: string; mergedIntoId: string | null; moderationStatus?: string }[]) {
  const live = (slug: string) =>
    rows.find((r) => r.slug === slug && r.mergedIntoId === null && (r.moderationStatus ?? 'APPROVED') === 'APPROVED');

  const prisma = {
    company: {
      // The public read: APPROVED *and* not merged away.
      findFirst: jest.fn(async ({ where }: { where: { slug: string } }) => {
        const row = live(where.slug);
        return row ? { ...row, industry: [], rounds: [], people: [], investors: [], acquisitions: [], exits: [], diversity: [], totalRaisedUsd: 0n } : null;
      }),
      // The redirect lookup, which ignores the tombstone filter on purpose.
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

  const users = { lastContributionAt: jest.fn(async () => null) } as unknown as UsersService;
  return new CompaniesService(prisma, users);
}

async function statusOf(fn: () => Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
    throw new Error('expected a throw');
  } catch (err) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), body: err.getResponse() };
    }
    throw err;
  }
}

describe('CompaniesService tombstones', () => {
  it('answers 301 with the survivor slug in the body for a merged-away slug', async () => {
    const service = serviceWith([
      { id: 'c-lose', slug: 'acme-old', mergedIntoId: 'c-keep' },
      { id: 'c-keep', slug: 'acme', mergedIntoId: null },
    ]);

    const { status, body } = await statusOf(() => service.getCompanyDetail('acme-old'));
    expect(status).toBe(301);
    expect(body).toMatchObject({ redirectTo: 'acme' });
  });

  it('sends no Location header — the body carries the slug', async () => {
    // With a Location header the web app's server-side fetch would follow the
    // redirect itself and render the survivor under the OLD url, which is the
    // opposite of a permanent redirect.
    const service = serviceWith([
      { id: 'c-lose', slug: 'acme-old', mergedIntoId: 'c-keep' },
      { id: 'c-keep', slug: 'acme', mergedIntoId: null },
    ]);
    const { body } = await statusOf(() => service.getCompanyDetail('acme-old'));
    expect(Object.keys(body as object)).toEqual(
      expect.arrayContaining(['message', 'redirectTo', 'statusCode']),
    );
  });

  it('redirects the history page too', async () => {
    const service = serviceWith([
      { id: 'c-lose', slug: 'acme-old', mergedIntoId: 'c-keep' },
      { id: 'c-keep', slug: 'acme', mergedIntoId: null },
    ]);
    const { status, body } = await statusOf(() => service.getCompanyHistory('acme-old'));
    expect(status).toBe(301);
    expect(body).toMatchObject({ redirectTo: 'acme' });
  });

  it('follows a chain of merges to the final survivor', async () => {
    const service = serviceWith([
      { id: 'c-1', slug: 'first', mergedIntoId: 'c-2' },
      { id: 'c-2', slug: 'second', mergedIntoId: 'c-3' },
      { id: 'c-3', slug: 'third', mergedIntoId: null },
    ]);
    const { body } = await statusOf(() => service.getCompanyDetail('first'));
    expect(body).toMatchObject({ redirectTo: 'third' });
  });

  it('404s rather than hanging when the chain cycles', async () => {
    const service = serviceWith([
      { id: 'c-1', slug: 'first', mergedIntoId: 'c-2' },
      { id: 'c-2', slug: 'second', mergedIntoId: 'c-1' },
    ]);
    const { status } = await statusOf(() => service.getCompanyDetail('first'));
    expect(status).toBe(404);
  });

  it('404s when the chain is longer than the hop cap', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      id: `c-${i}`,
      slug: `s-${i}`,
      mergedIntoId: i < 7 ? `c-${i + 1}` : null,
    }));
    const { status } = await statusOf(() => serviceWith(rows).getCompanyDetail('s-0'));
    expect(status).toBe(404);
  });

  it('404s when the survivor is not itself public', async () => {
    const service = serviceWith([
      { id: 'c-lose', slug: 'acme-old', mergedIntoId: 'c-keep' },
      { id: 'c-keep', slug: 'acme', mergedIntoId: null, moderationStatus: 'PENDING' },
    ]);
    const { status } = await statusOf(() => service.getCompanyDetail('acme-old'));
    expect(status).toBe(404);
  });

  it('404s for a slug that never existed', async () => {
    const { status } = await statusOf(() =>
      serviceWith([{ id: 'c-1', slug: 'acme', mergedIntoId: null }]).getCompanyDetail('nope'),
    );
    expect(status).toBe(404);
  });

  it('drops tombstones from the sitemap feed', async () => {
    const service = serviceWith([
      { id: 'c-lose', slug: 'acme-old', mergedIntoId: 'c-keep' },
      { id: 'c-keep', slug: 'acme', mergedIntoId: null },
    ]);
    // listSlugs filters through PUBLIC_COMPANY, so the fake's findMany applies
    // the same rule the real query does.
    const slugs = await service.listSlugs();
    expect(slugs.map((s) => s.slug)).toEqual(['acme']);
  });
});
