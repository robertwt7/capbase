import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

type Row = Record<string, unknown> & { id: string };

/** A tiny in-memory Prisma stand-in — enough `where` semantics (equality and
 *  `{ in }`) that the public-filter assertions mean something. */
function table(rows: Row[] = []) {
  const match = (row: Row, where: Record<string, unknown> = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v !== null && typeof v === 'object' && 'in' in (v as object)) {
        return (v as { in: unknown[] }).in.includes(row[k]);
      }
      return (row[k] ?? null) === v;
    });

  return {
    rows,
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((r) => match(r, where)) ?? null,
    findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.find((r) => match(r, where)) ?? null,
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.filter((r) => match(r, where)).map((r) => ({ ...r })),
    count: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      rows.filter((r) => match(r, where)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `gen-${rows.length + 1}`, ...data } as Row;
      rows.push(row);
      return { ...row };
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
  };
}

const PUBLIC = { moderationStatus: 'APPROVED', mergedIntoId: null };

function fixture() {
  const db = {
    company: table([
      { id: 'c-1', slug: 'acme', name: 'Acme', ...PUBLIC },
      {
        id: 'c-pending',
        slug: 'pending-co',
        name: 'Pending',
        moderationStatus: 'PENDING',
        mergedIntoId: null,
      },
      {
        id: 'c-tomb',
        slug: 'old-acme',
        name: 'Old Acme',
        moderationStatus: 'APPROVED',
        mergedIntoId: 'c-1',
      },
    ]),
    investor: table([{ id: 'i-1', slug: 'big', name: 'Big Fund', ...PUBLIC }]),
    person: table([
      {
        id: 'p-1',
        slug: 'jane',
        name: 'Jane Smith',
        ...PUBLIC,
        suppressedAt: null,
      },
      {
        id: 'p-hidden',
        slug: 'hidden',
        name: 'Hidden',
        ...PUBLIC,
        suppressedAt: new Date(),
      },
    ]),
    report: table([]),
  };
  // Failure inside the transaction must leave every table as it was, so the
  // stand-in snapshots and restores — the atomicity the service relies on.
  const prisma = {
    ...db,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = Object.fromEntries(
        Object.entries(db).map(([k, t]) => [k, t.rows.map((r) => ({ ...r }))]),
      );
      try {
        return await fn(prisma);
      } catch (err) {
        for (const [k, rows] of Object.entries(snapshot)) {
          db[k as keyof typeof db].rows.splice(0, Infinity, ...rows);
        }
        throw err;
      }
    },
  };
  return {
    db,
    service: new ReportsService(prisma as unknown as PrismaService),
  };
}

const base = {
  reason: 'Incorrect' as const,
  message: '  The founding year is wrong.  ',
};

describe('ReportsService', () => {
  describe('create', () => {
    it.each([
      ['company', 'acme', 'c-1'],
      ['investor', 'big', 'i-1'],
      ['person', 'jane', 'p-1'],
    ] as const)(
      'resolves a public %s slug to its row id',
      async (entityType, slug, id) => {
        const { db, service } = fixture();
        await service.create({
          ...base,
          entityType,
          slug,
          email: ' Me@Example.COM ',
        });
        expect(db.report.rows[0]).toMatchObject({
          entityType,
          entityId: id,
          message: 'The founding year is wrong.',
          email: 'me@example.com',
        });
      },
    );

    it.each([
      ['company', 'nope'],
      ['company', 'pending-co'],
      ['company', 'old-acme'],
      ['person', 'hidden'],
    ] as const)(
      '404s for a %s the public cannot see (%s)',
      async (entityType, slug) => {
        const { db, service } = fixture();
        await expect(
          service.create({ ...base, entityType, slug }),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(db.report.rows).toHaveLength(0);
      },
    );

    it('stores a missing email as null', async () => {
      const { db, service } = fixture();
      await service.create({ ...base, entityType: 'company', slug: 'acme' });
      expect(db.report.rows[0]!.email).toBeNull();
    });
  });

  describe('resolve', () => {
    it('suppresses the person and closes the report together', async () => {
      const { db, service } = fixture();
      const { id } = await service.create({
        ...base,
        entityType: 'person',
        slug: 'jane',
      });
      await service.resolve(
        id,
        { note: 'Removal request', suppressPerson: true },
        'admin-1',
      );

      expect(
        db.person.rows.find((p) => p.id === 'p-1')!.suppressedAt,
      ).toBeInstanceOf(Date);
      expect(db.report.rows[0]).toMatchObject({
        status: 'RESOLVED',
        resolutionNote: 'Removal request',
        resolvedById: 'admin-1',
      });
    });

    it('refuses suppressPerson on a non-person report and leaves it open', async () => {
      const { db, service } = fixture();
      const { id } = await service.create({
        ...base,
        entityType: 'company',
        slug: 'acme',
      });
      await expect(
        service.resolve(id, { suppressPerson: true }, 'admin-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.report.rows[0]!.status).toBeUndefined(); // DB default OPEN, never written
    });

    it('records the note and link without touching the entity', async () => {
      const { db, service } = fixture();
      const { id } = await service.create({
        ...base,
        entityType: 'person',
        slug: 'jane',
      });
      await service.resolve(
        id,
        { note: 'Fixed', url: 'https://capbase.fyi/x' },
        'admin-1',
      );
      expect(db.report.rows[0]).toMatchObject({
        status: 'RESOLVED',
        resolutionUrl: 'https://capbase.fyi/x',
      });
      expect(
        db.person.rows.find((p) => p.id === 'p-1')!.suppressedAt,
      ).toBeNull();
    });

    it('404s on a missing report', async () => {
      const { service } = fixture();
      await expect(
        service.resolve('nope', {}, 'admin-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('dismiss', () => {
    it('marks the report DISMISSED with the note', async () => {
      const { db, service } = fixture();
      const { id } = await service.create({
        ...base,
        entityType: 'company',
        slug: 'acme',
      });
      await service.dismiss(id, { note: '  Not an error  ' }, 'admin-1');
      expect(db.report.rows[0]).toMatchObject({
        status: 'DISMISSED',
        resolutionNote: 'Not an error',
      });
    });

    it('404s on a missing report', async () => {
      const { service } = fixture();
      await expect(
        service.dismiss('nope', {}, 'admin-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list', () => {
    it('resolves entities without the public filter, null when gone', async () => {
      const { db, service } = fixture();
      const now = new Date();
      db.report.rows.push(
        {
          id: 'r-1',
          entityType: 'person',
          entityId: 'p-hidden',
          status: 'OPEN',
          createdAt: now,
        },
        {
          id: 'r-2',
          entityType: 'company',
          entityId: 'c-gone',
          status: 'OPEN',
          createdAt: now,
        },
        {
          id: 'r-3',
          entityType: 'company',
          entityId: 'c-1',
          status: 'RESOLVED',
          createdAt: now,
        },
      );
      const queue = await service.list('OPEN');

      expect(queue.total).toBe(2);
      const byId = Object.fromEntries(queue.items.map((i) => [i.id, i]));
      expect(byId['r-1']!.entity).toEqual({
        name: 'Hidden',
        slug: 'hidden',
        suppressed: true,
      });
      expect(byId['r-2']!.entity).toBeNull();
    });
  });
});
