import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import { Prisma } from '@repo/db';

import { PrismaService } from '../prisma/prisma.service';
import { escapeLike, SearchService } from './search.service';

type Row = Record<string, unknown>;

describe('escapeLike', () => {
  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLike('Stripe, Inc.')).toBe('Stripe, Inc.');
  });
});

describe('SearchService', () => {
  let service: SearchService;
  let queryRaw: jest.Mock<(...args: unknown[]) => Promise<Row[]>>;
  let roleFindMany: jest.Mock<(args: unknown) => Promise<Row[]>>;
  // What each of the three raw queries returns, in call order.
  let companies: Row[];
  let investors: Row[];
  let people: Row[];

  beforeEach(() => {
    companies = [];
    investors = [];
    people = [];
    // A tagged-template call passes (strings, ...values). The three queries are
    // issued in a fixed order inside one Promise.all.
    queryRaw = jest.fn(async (strings: unknown) => {
      const sql = (strings as string[]).join('?');
      if (sql.includes('FROM "Company"')) return companies;
      if (sql.includes('FROM "Investor"')) return investors;
      return people;
    });
    roleFindMany = jest.fn(async () => []);
    const prisma = {
      $queryRaw: queryRaw,
      personRole: { findMany: roleFindMany },
    } as unknown as PrismaService;
    service = new SearchService(prisma);
  });

  it.each(['', 'a', ' a ', '   '])(
    'does not query the DB for %j',
    async (q) => {
      await expect(service.search(q)).resolves.toEqual({
        companies: [],
        investors: [],
        people: [],
      });
      expect(queryRaw).not.toHaveBeenCalled();
      expect(roleFindMany).not.toHaveBeenCalled();
    },
  );

  it('runs one query per group with the escaped patterns as bound parameters', async () => {
    await service.search(' 100%_A ');

    expect(queryRaw).toHaveBeenCalledTimes(3);
    for (const call of queryRaw.mock.calls) {
      const [strings, ...values] = call;
      // Parameterised, never interpolated into the SQL text.
      expect((strings as string[]).join('')).not.toContain('100');
      expect(values).toEqual(
        expect.arrayContaining([
          '%100\\%\\_a%',
          '100\\%\\_a%',
          '% 100\\%\\_a%',
          '100%_a',
        ]),
      );
    }
  });

  it('restates every public filter in its query', async () => {
    await service.search('acme');
    const sql = queryRaw.mock.calls.map((c) => (c[0] as string[]).join('?'));

    for (const s of sql) {
      expect(s).toContain(`"moderationStatus" = 'APPROVED'`);
      expect(s).toContain(`"mergedIntoId" IS NULL`);
    }
    expect(sql.find((s) => s.includes('FROM "Person"'))).toContain(
      `"suppressedAt" IS NULL`,
    );
  });

  describe('the read gate', () => {
    /** Every SQL fragment of each raw query, nested `Prisma.sql` parts included. */
    const fragments = () =>
      queryRaw.mock.calls.map(([strings, ...values]) =>
        [
          ...(strings as string[]),
          ...values.flatMap((v) => (v instanceof Prisma.Sql ? v.strings : [])),
        ].join('?'),
      );

    it('never finds the partner’s entities or shows its values to a signed-out viewer', async () => {
      await service.search('acme');
      const [company, investor, person] = ['Company', 'Investor', 'Person'].map((t) =>
        fragments().find((s) => s.includes(`FROM "${t}"`))!,
      );
      expect(company).toContain('NOT "partnerOnly"');
      expect(company).toContain('ANY("partnerFields")');
      expect(investor).toContain('NOT "partnerOnly"');
      expect(person).toContain('NOT "identifierOnly"');
    });

    it('searches everything for a signed-in viewer', async () => {
      await service.search('acme', { id: 'u1' });
      for (const s of fragments()) {
        expect(s).not.toContain('partnerOnly');
        expect(s).not.toContain('identifierOnly');
        expect(s).not.toContain('partnerFields');
      }
    });
  });

  it('maps rows to hits, turning an empty domain or meta into null', async () => {
    companies = [
      { slug: 'acme', name: 'Acme', domain: 'acme.com', meta: 'Fintech' },
      { slug: 'acme-2', name: 'Acme Two', domain: null, meta: null },
    ];
    investors = [
      { slug: 'acme-vc', name: 'Acme Ventures', domain: '', meta: 'Venture' },
    ];

    const res = await service.search('acme');

    expect(res.companies).toEqual([
      { slug: 'acme', name: 'Acme', domain: 'acme.com', meta: 'Fintech' },
      { slug: 'acme-2', name: 'Acme Two', domain: null, meta: null },
    ]);
    expect(res.investors).toEqual([
      { slug: 'acme-vc', name: 'Acme Ventures', domain: null, meta: 'Venture' },
    ]);
    expect(res.people).toEqual([]);
  });

  it('skips the role lookup when no person matched', async () => {
    companies = [
      { slug: 'acme', name: 'Acme', domain: 'acme.com', meta: null },
    ];

    await service.search('acme');

    expect(roleFindMany).not.toHaveBeenCalled();
  });

  it("labels each person with their latest public role's organisation", async () => {
    people = [
      { id: 'p1', slug: 'jane', name: 'Jane Acme', domain: null, meta: null },
      { id: 'p2', slug: 'john', name: 'John Acme', domain: null, meta: null },
      { id: 'p3', slug: 'jo', name: 'Jo Acme', domain: null, meta: null },
    ];
    // Ordered by `since` desc, as the query asks — the first per person wins.
    roleFindMany.mockResolvedValue([
      { personId: 'p1', company: { name: 'Acme, Inc.' }, investor: null },
      { personId: 'p2', company: null, investor: { name: 'Acme Ventures' } },
      { personId: 'p1', company: { name: 'Older Co' }, investor: null },
    ]);

    const res = await service.search('acme');

    expect(res.people).toEqual([
      { slug: 'jane', name: 'Jane Acme', domain: null, meta: 'Acme, Inc.' },
      { slug: 'john', name: 'John Acme', domain: null, meta: 'Acme Ventures' },
      { slug: 'jo', name: 'Jo Acme', domain: null, meta: null },
    ]);
    // No id leaks into the response.
    res.people.forEach((p) => expect(p).not.toHaveProperty('id'));

    const args = roleFindMany.mock.calls[0]![0] as {
      where: { personId: { in: string[] }; moderationStatus: string };
    };
    expect(args.where.personId.in).toEqual(['p1', 'p2', 'p3']);
    expect(args.where.moderationStatus).toBe('APPROVED');
  });
});
