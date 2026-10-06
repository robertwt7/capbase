import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { HttpException, NotFoundException } from '@nestjs/common';

import { PERSON_INDEX_MIN_ROLES } from '@repo/api';

import { PeopleService } from './people.service';
import { PrismaService } from '../prisma/prisma.service';

function role(over: Record<string, unknown> = {}) {
  return {
    id: 'pr-1',
    role: 'Executive Officer',
    kind: 'Executive officer',
    title: 'CEO',
    since: 2021,
    endYear: null,
    prior: null,
    linkedinUrl: null,
    company: { slug: 'acme', name: 'Acme, Inc.', domain: 'acme.com' },
    investor: null,
    ...over,
  };
}

function personRow(over: Record<string, unknown> = {}) {
  return {
    id: 'h-1',
    slug: 'jane-smith',
    name: 'Jane Smith',
    normalizedName: 'jane smith',
    mergedIntoId: null,
    suppressedAt: null,
    moderationStatus: 'APPROVED',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-02-01'),
    roles: [role()],
    _count: { roles: 1 },
    ...over,
  };
}

describe('PeopleService', () => {
  let service: PeopleService;
  let findMany: jest.Mock;
  let count: jest.Mock;
  let findFirst: jest.Mock;
  let findUnique: jest.Mock;
  let citationFindMany: jest.Mock;
  let roleFindMany: jest.Mock;
  let queryRaw: jest.Mock;
  let identifierFindMany: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn();
    count = jest.fn();
    findFirst = jest.fn();
    // findUnique backs the miss path: is this slug a tombstone, or nothing?
    findUnique = jest.fn(async () => null);
    citationFindMany = jest.fn(async () => []);
    // The distinct (personId, companyId) pairs behind companyCount.
    roleFindMany = jest.fn(async () => []);
    // The exact "roles at 2+ public companies" id set.
    queryRaw = jest.fn(async () => []);
    identifierFindMany = jest.fn(async () => []);
    const prisma = {
      person: { findMany, count, findFirst, findUnique, update: jest.fn() },
      personRole: { findMany: roleFindMany },
      $queryRaw: queryRaw,
      citation: { findMany: citationFindMany },
      entityIdentifier: { findMany: identifierFindMany },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    service = new PeopleService(prisma);
  });

  describe('findAll', () => {
    it('maps a person and their roles into a summary', async () => {
      count.mockResolvedValue(1);
      findMany.mockResolvedValue([
        personRow({
          roles: [
            role({ id: 'pr-1', company: { slug: 'acme', name: 'Acme', domain: 'acme.com' } }),
            role({ id: 'pr-2', company: { slug: 'helia', name: 'Helia', domain: 'helia.com' } }),
          ],
          _count: { roles: 2 },
        }),
      ]);

      roleFindMany.mockResolvedValue([
        { personId: 'h-1', companyId: 'c-acme' },
        { personId: 'h-1', companyId: 'c-helia' },
      ]);

      const { items, total } = await service.findAll();

      expect(total).toBe(1);
      expect(items[0]).toMatchObject({ slug: 'jane-smith', roleCount: 2, companyCount: 2 });
      expect(items[0]!.roles[0]).toMatchObject({ kind: 'Executive officer', title: 'CEO' });
    });

    it('takes roleCount from the filtered relation count, not the sample', async () => {
      count.mockResolvedValue(1);
      findMany.mockResolvedValue([personRow({ roles: [role()], _count: { roles: 75 } })]);

      const { items } = await service.findAll();
      expect(items[0]!.roleCount).toBe(75);
      expect(items[0]!.roles).toHaveLength(1);
    });

    it('orders by role count by default and by name when asked', async () => {
      count.mockResolvedValue(0);
      findMany.mockResolvedValue([]);

      await service.findAll();
      expect(findMany.mock.calls[0]![0]).toMatchObject({
        orderBy: [{ roles: { _count: 'desc' } }, { name: 'asc' }],
      });

      await service.findAll({ sort: 'name' });
      expect(findMany.mock.calls[1]![0]).toMatchObject({ orderBy: [{ name: 'asc' }] });
    });

    it('filters by search term and paginates', async () => {
      count.mockResolvedValue(0);
      findMany.mockResolvedValue([]);

      const result = await service.findAll({ q: 'smith', page: 3, pageSize: 10 });

      expect(findMany.mock.calls[0]![0]).toMatchObject({
        where: {
          moderationStatus: 'APPROVED',
          mergedIntoId: null,
          suppressedAt: null,
          name: { contains: 'smith', mode: 'insensitive' },
        },
        skip: 20,
        take: 10,
      });
      expect(result).toMatchObject({ page: 3, pageSize: 10, total: 0 });
    });

    it('multiCompany narrows the query itself, so total is not a lie', async () => {
      // A `roles: { some: … }` filter can only ask "has a company role", which
      // nearly everyone satisfies: it reported 75,926 people against a true
      // 4,393. Post-filtering the page would fix the rows and leave the count
      // and the pagination wrong, so the id set goes into the WHERE.
      queryRaw.mockResolvedValue([{ personId: 'h-two' }]);
      count.mockResolvedValue(1);
      findMany.mockResolvedValue([personRow({ id: 'h-two', slug: 'serial-founder' })]);

      const { items, total } = await service.findAll({ multiCompany: true });

      expect(total).toBe(1);
      expect(items.map((p) => p.slug)).toEqual(['serial-founder']);
      expect(findMany.mock.calls[0]![0]).toMatchObject({
        where: { id: { in: ['h-two'] } },
      });
      // Both halves of the page query see the same filter.
      expect(count.mock.calls[0]![0]).toMatchObject({ where: { id: { in: ['h-two'] } } });
    });

    it('does not run the multi-company query when the filter is off', async () => {
      count.mockResolvedValue(0);
      findMany.mockResolvedValue([]);
      await service.findAll();
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('counts companies exactly, not from the role sample', async () => {
      // A person at 75 companies must not show 6 because that is how many roles
      // the card loads.
      count.mockResolvedValue(1);
      findMany.mockResolvedValue([personRow({ roles: [role()], _count: { roles: 75 } })]);
      roleFindMany.mockResolvedValue(
        Array.from({ length: 75 }, (_, i) => ({ personId: 'h-1', companyId: `c-${i}` })),
      );

      const { items } = await service.findAll();
      expect(items[0]!.companyCount).toBe(75);
      expect(roleFindMany.mock.calls[0]![0]).toMatchObject({
        distinct: ['personId', 'companyId'],
      });
    });

    it('counts only approved roles on public companies, and keeps firm roles', async () => {
      count.mockResolvedValue(0);
      findMany.mockResolvedValue([]);
      await service.findAll();

      const args = findMany.mock.calls[0]![0] as {
        include: { _count: { select: { roles: { where: unknown } } } };
      };
      expect(args.include._count.select.roles.where).toEqual({
        moderationStatus: 'APPROVED',
        // A firm-officer role has no company, so the OR is what keeps it visible.
        OR: [{ company: { moderationStatus: 'APPROVED', mergedIntoId: null } }, { companyId: null }],
      });
    });
  });

  describe('findOne', () => {
    it('returns every role, with the citations attesting them', async () => {
      findFirst.mockResolvedValue(personRow());
      const person = await service.findOne('jane-smith');

      expect(person.slug).toBe('jane-smith');
      expect(person.roles).toHaveLength(1);
      // Citations anchor to the ROLE row, not to the human.
      expect(citationFindMany.mock.calls[0]![0]).toMatchObject({
        where: { entityType: 'person', entityId: { in: ['pr-1'] } },
      });
    });

    it('distinguishes a firm role from a company role', async () => {
      findFirst.mockResolvedValue(
        personRow({
          roles: [role({ company: null, investor: { slug: 'sequoia', name: 'Sequoia Capital' } })],
        }),
      );

      const person = await service.findOne('jane-smith');
      expect(person.roles[0]!.company).toBeNull();
      expect(person.roles[0]!.investor).toMatchObject({ slug: 'sequoia' });
      // A firm role contributes no company to the count.
      expect(person.companyCount).toBe(0);
    });

    it('301s a tombstoned slug with the survivor in the body', async () => {
      findFirst.mockResolvedValue(null);
      findUnique
        .mockResolvedValueOnce({ slug: 'jane-a-smith', mergedIntoId: 'h-1', moderationStatus: 'APPROVED', suppressedAt: null })
        .mockResolvedValueOnce({ slug: 'jane-smith', mergedIntoId: null, moderationStatus: 'APPROVED', suppressedAt: null });

      await expect(service.findOne('jane-a-smith')).rejects.toMatchObject({
        // No Location header — the web app's server-side fetch would follow it
        // and render the survivor under the old URL.
        response: { redirectTo: 'jane-smith', statusCode: 301 },
      });
    });

    it('resolves a chain of merges, and terminates on a cycle', async () => {
      findFirst.mockResolvedValue(null);
      // a → b → c (live)
      findUnique
        .mockResolvedValueOnce({ slug: 'a', mergedIntoId: 'h-b', moderationStatus: 'APPROVED', suppressedAt: null })
        .mockResolvedValueOnce({ slug: 'b', mergedIntoId: 'h-c', moderationStatus: 'APPROVED', suppressedAt: null })
        .mockResolvedValueOnce({ slug: 'c', mergedIntoId: null, moderationStatus: 'APPROVED', suppressedAt: null });
      await expect(service.findOne('a')).rejects.toBeInstanceOf(HttpException);

      // A cycle: every hop points at another merged row, so the cap ends it.
      findUnique.mockReset();
      findUnique.mockResolvedValue({
        slug: 'x',
        mergedIntoId: 'h-y',
        moderationStatus: 'APPROVED',
        suppressedAt: null,
      });
      await expect(service.findOne('x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s a suppressed person rather than redirecting to them', async () => {
      // A 301 would confirm they exist, which is the opposite of what a removal
      // request asks for.
      findFirst.mockResolvedValue(null);
      findUnique
        .mockResolvedValueOnce({ slug: 'old', mergedIntoId: 'h-1', moderationStatus: 'APPROVED', suppressedAt: null })
        .mockResolvedValueOnce({ slug: 'jane-smith', mergedIntoId: null, moderationStatus: 'APPROVED', suppressedAt: new Date() });

      await expect(service.findOne('old')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s a slug nothing answers to', async () => {
      findFirst.mockResolvedValue(null);
      await expect(service.findOne('nobody')).rejects.toBeInstanceOf(NotFoundException);
    });

    describe('indexable', () => {
      it('is false for a one-role person', async () => {
        findFirst.mockResolvedValue(personRow({ _count: { roles: 1 } }));
        expect((await service.findOne('jane-smith')).indexable).toBe(false);
      });

      it('is true at two public roles', async () => {
        findFirst.mockResolvedValue(
          personRow({ roles: [role({ id: 'pr-1' }), role({ id: 'pr-2' })], _count: { roles: 2 } }),
        );
        expect((await service.findOne('jane-smith')).indexable).toBe(true);
      });

      it('counts the loaded public roles instead of asking for a relation count', async () => {
        // A filtered `_count` makes Prisma aggregate the whole PersonRole table
        // for one person; the detail read already loads every public role.
        findFirst.mockResolvedValue(
          personRow({ roles: [role(), role({ id: 'pr-2' })], _count: undefined }),
        );
        const person = await service.findOne('jane-smith');
        expect(person.roleCount).toBe(2);
        expect(person.indexable).toBe(true);
        const args = findFirst.mock.calls[0]![0] as { include: Record<string, unknown> };
        expect(args.include).not.toHaveProperty('_count');
      });

      it('is true for a one-role person with a Wikidata identifier', async () => {
        findFirst.mockResolvedValue(personRow({ _count: { roles: 1 } }));
        identifierFindMany.mockResolvedValue([
          { id: 'e-1', scheme: 'WIKIDATA', value: 'Q42', entityType: 'person', entityId: 'h-1' },
        ]);
        expect((await service.findOne('jane-smith')).indexable).toBe(true);
      });
    });
  });

  // The SQL's row-level behaviour (one role out, two in, QID in, suppressed and
  // merged out) runs against Postgres in test/indexing.e2e-spec.ts; a mocked
  // $queryRaw can only check what the query says.
  describe('listSlugs', () => {
    /** The raw SQL text with its parameters, from a tagged-template call. */
    function sqlOf(call: unknown[]): { text: string; values: unknown[] } {
      const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
      return { text: strings.join('?').replace(/\s+/g, ' '), values };
    }

    it('maps rows to ISO timestamps for the sitemap', async () => {
      queryRaw.mockResolvedValue([{ slug: 'jane-smith', updatedAt: new Date('2026-02-01') }]);
      await expect(service.listSlugs()).resolves.toEqual([
        { slug: 'jane-smith', updatedAt: '2026-02-01T00:00:00.000Z' },
      ]);
    });

    it('excludes tombstoned and suppressed people', async () => {
      await service.listSlugs();
      const { text } = sqlOf(queryRaw.mock.calls[0]!);
      expect(text).toContain(`p."moderationStatus" = 'APPROVED'`);
      expect(text).toContain('p."mergedIntoId" IS NULL');
      expect(text).toContain('p."suppressedAt" IS NULL');
    });

    it('requires PERSON_INDEX_MIN_ROLES public roles or a Wikidata identifier', async () => {
      await service.listSlugs();
      const { text, values } = sqlOf(queryRaw.mock.calls[0]!);
      expect(values).toEqual([PERSON_INDEX_MIN_ROLES]);
      // The roles counted are PUBLIC_ROLES: approved, on a public company or on none.
      expect(text).toContain(`r."moderationStatus" = 'APPROVED'`);
      expect(text).toContain(`r."companyId" IS NULL OR (c."moderationStatus" = 'APPROVED' AND c."mergedIntoId" IS NULL)`);
      expect(text).toContain(`e.scheme = 'WIKIDATA'`);
    });
  });
});
