import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { InvestorsService } from './investors.service';
import { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';

/** Gate-neutral by default: an unlocked viewer sees what these tests describe. */
const unlockedUsers = { accessFor: async () => ({ unlocked: true, signedIn: true, unlockedUntil: null }) } as unknown as UsersService;

function company(slug: string, name: string, primarySector: string | null) {
  return { slug, name, domain: `${slug}.com`, primarySector };
}

function investorRow(over: Record<string, unknown> = {}) {
  return {
    id: 'i-1',
    slug: 'sequoia-capital',
    name: 'Sequoia Capital',
    legalName: null,
    type: 'Venture',
    hq: 'Menlo Park, CA',
    websiteUrl: 'https://www.sequoiacap.com',
    linkedinUrl: null,
    domain: 'sequoiacap.com',
    description: null,
    crdNumber: null,
    cikNumber: null,
    fundCount: null,
    assetsUsd: null,
    foundedYear: 1972,
    holdings: [],
    funds: [],
    // Officers Wikidata names on the firm itself; empty for most firms.
    people: [],
    commitments: [],
    ...over,
    // Spread last so a test can override one count without restating the rest.
    _count: {
      holdings: 0,
      funds: 0,
      people: (over.people as unknown[] | undefined)?.length ?? 0,
      commitments: 0,
      ...(over._count as Record<string, number> | undefined),
    },
  };
}

function fundRow(over: Record<string, unknown> = {}) {
  return {
    id: 'f-1',
    name: 'Sequoia Growth Fund III, L.P.',
    strategy: 'Venture capital',
    vintageYear: 2022,
    targetUsd: null,
    closedUsd: null,
    grossAssetsUsd: 3_030_000_000n,
    currency: 'USD',
    hq: 'CA, United States',
    ...over,
  };
}

describe('InvestorsService', () => {
  let service: InvestorsService;
  let findMany: jest.Mock;
  let count: jest.Mock;
  let findFirst: jest.Mock;
  let transaction: jest.Mock;
  let citationFindMany: jest.Mock;
  let identifierFindMany: jest.Mock;
  let relationCounts: Record<'holdings' | 'funds' | 'people' | 'commitments', jest.Mock>;

  beforeEach(() => {
    findMany = jest.fn();
    count = jest.fn();
    findFirst = jest.fn();
    citationFindMany = jest.fn(async () => []);
    identifierFindMany = jest.fn(async () => []);
    // $transaction resolves the array of queries it is handed.
    transaction = jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));
    // The detail read counts each relation with its own query; these read the
    // fixture's `_count` off the row findFirst last returned.
    const countOf = (key: string) =>
      jest.fn(async () => {
        const row = (await findFirst.mock.results.at(-1)?.value) as
          | { _count?: Record<string, number> }
          | null
          | undefined;
        return row?._count?.[key] ?? 0;
      });
    relationCounts = {
      holdings: countOf('holdings'),
      funds: countOf('funds'),
      people: countOf('people'),
      commitments: countOf('commitments'),
    };
    const prisma = {
      // findUnique backs the miss path: is this slug a tombstone, or nothing?
      investor: { findMany, count, findFirst, findUnique: jest.fn(async () => null) },
      investorHolding: { count: relationCounts.holdings },
      fund: { count: relationCounts.funds },
      personRole: { count: relationCounts.people },
      fundCommitment: { count: relationCounts.commitments },
      company: { findMany: jest.fn(async () => []) },
      citation: { findMany: citationFindMany },
      entityIdentifier: { findMany: identifierFindMany },
      $transaction: transaction,
    } as unknown as PrismaService;
    service = new InvestorsService(prisma, unlockedUsers);
  });

  describe('findAll', () => {
    it('maps a row and its portfolio into a summary', async () => {
      count.mockResolvedValue(1);
      findMany.mockResolvedValue([
        investorRow({
          holdings: [
            { company: company('sable-labs', 'Sable Labs', 'Artificial intelligence') },
            { company: company('helia', 'Helia', 'Fintech') },
          ],
          _count: { holdings: 2 },
        }),
      ]);

      const { items, total } = await service.findAll();
      const [investor] = items;

      expect(total).toBe(1);
      expect(investor!.slug).toBe('sequoia-capital');
      expect(investor!.name).toBe('Sequoia Capital');
      expect(investor!.portfolioCount).toBe(2);
      // Companies are sorted by name, sectors deduped and sorted.
      expect(investor!.companies.map((c) => c.name)).toEqual(['Helia', 'Sable Labs']);
      expect(investor!.sectors).toEqual(['Artificial intelligence', 'Fintech']);
    });

    it('takes portfolioCount from the filtered relation count, not the sample', async () => {
      count.mockResolvedValue(1);
      findMany.mockResolvedValue([
        investorRow({
          // The list read only loads a sample of holdings…
          holdings: [{ company: company('helia', 'Helia', 'Fintech') }],
          // …so the real total must come from _count.
          _count: { holdings: 28 },
        }),
      ]);

      const { items } = await service.findAll();
      expect(items[0]!.portfolioCount).toBe(28);
      expect(items[0]!.companies).toHaveLength(1);
    });

    it('includes investors with no portfolio at all', async () => {
      // The SEC Form ADV universe is mostly firms with no disclosed portfolio;
      // hiding them would drop ~85% of the directory.
      count.mockResolvedValue(1);
      findMany.mockResolvedValue([
        investorRow({ slug: 'next-coast-ventures', name: 'Next Coast Ventures' }),
      ]);

      const { items } = await service.findAll();
      expect(items[0]!.portfolioCount).toBe(0);
      expect(items[0]!.companies).toEqual([]);
      expect(items[0]!.sectors).toEqual([]);
      // No `holdings: { some: … }` filter may creep into the where clause.
      expect(findMany.mock.calls[0]![0]).toMatchObject({
        where: { moderationStatus: 'APPROVED', mergedIntoId: null },
      });
    });

    it('orders by portfolio size by default and by name when asked', async () => {
      count.mockResolvedValue(0);
      findMany.mockResolvedValue([]);

      await service.findAll();
      expect(findMany.mock.calls[0]![0]).toMatchObject({
        orderBy: [{ holdings: { _count: 'desc' } }, { name: 'asc' }],
      });

      await service.findAll({ sort: 'name' });
      expect(findMany.mock.calls[1]![0]).toMatchObject({ orderBy: [{ name: 'asc' }] });
    });

    it('filters by search term and type, and paginates', async () => {
      count.mockResolvedValue(0);
      findMany.mockResolvedValue([]);

      const result = await service.findAll({ q: 'sequoia', type: 'Venture', page: 3, pageSize: 10 });

      expect(findMany.mock.calls[0]![0]).toMatchObject({
        where: {
          moderationStatus: 'APPROVED',
          name: { contains: 'sequoia', mode: 'insensitive' },
          type: 'Venture',
        },
        skip: 20,
        take: 10,
      });
      expect(result).toMatchObject({ page: 3, pageSize: 10, total: 0 });
    });

    it('filters by country', async () => {
      count.mockResolvedValue(0);
      findMany.mockResolvedValue([]);
      await service.findAll({ country: 'GB' });
      expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { countryCode: 'GB' } });
    });

    it('counts only approved holdings on approved companies', async () => {
      count.mockResolvedValue(0);
      findMany.mockResolvedValue([]);
      await service.findAll();

      const args = findMany.mock.calls[0]![0] as {
        include: { _count: { select: { holdings: { where: unknown } } } };
      };
      expect(args.include._count.select.holdings.where).toEqual({
        moderationStatus: 'APPROVED',
        company: { moderationStatus: 'APPROVED', mergedIntoId: null },
      });
    });
  });

  describe('findOne', () => {
    it('returns the full portfolio for an approved investor', async () => {
      findFirst.mockResolvedValue(
        investorRow({
          holdings: [{ company: company('helia', 'Helia', 'Fintech') }],
          _count: { holdings: 1, funds: 0 },
          fundCount: 119,
          assetsUsd: 106_486_870_258n,
        }),
      );

      const investor = await service.findOne('sequoia-capital');

      expect(investor.slug).toBe('sequoia-capital');
      expect(investor.portfolioCount).toBe(1);
      expect(investor.fundCount).toBe(119);
      // BigInt money columns cross the wire as numbers.
      expect(investor.assetsUsd).toBe(106_486_870_258);
      expect(findFirst.mock.calls[0]![0]).toMatchObject({
        where: { slug: 'sequoia-capital', moderationStatus: 'APPROVED', mergedIntoId: null },
      });
    });

    it('returns the named funds and both counts, which are different facts', async () => {
      findFirst.mockResolvedValue(
        investorRow({
          fundCount: 119,
          funds: [fundRow()],
          _count: { holdings: 0, funds: 92 },
        }),
      );

      const investor = await service.findOne('sequoia-capital');

      // What the firm told the SEC vs what the public archive lets us name.
      expect(investor.fundCount).toBe(119);
      expect(investor.namedFundCount).toBe(92);
      expect(investor.funds).toHaveLength(1);
      expect(investor.funds[0]).toMatchObject({
        id: 'f-1',
        strategy: 'Venture capital',
        vintageYear: 2022,
        grossAssetsUsd: 3_030_000_000,
        targetUsd: null,
      });
      // Preview only — the SPV platforms report tens of thousands.
      expect(findFirst.mock.calls[0]![0]).toMatchObject({
        include: { funds: { where: { moderationStatus: 'APPROVED' }, take: 12 } },
      });
    });

    it('loads citations only for the fund rows it is returning', async () => {
      findFirst.mockResolvedValue(
        investorRow({ funds: [fundRow()], _count: { holdings: 0, funds: 1 } }),
      );
      await service.findOne('sequoia-capital');

      expect(citationFindMany.mock.calls[0]![0]).toMatchObject({
        where: { entityType: 'fund', entityId: { in: ['f-1'] } },
      });
    });

    it('does not query citations when the firm has no named funds', async () => {
      findFirst.mockResolvedValue(investorRow());
      const investor = await service.findOne('sequoia-capital');

      expect(investor.funds).toEqual([]);
      expect(investor.citations).toEqual([]);
      expect(citationFindMany).not.toHaveBeenCalled();
    });

    it('404s for an unknown or unapproved slug', async () => {
      findFirst.mockResolvedValue(null);
      await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    describe('indexable', () => {
      it('is false for a firm with nothing on its profile but a name', async () => {
        findFirst.mockResolvedValue(investorRow());
        expect((await service.findOne('sequoia-capital')).indexable).toBe(false);
      });

      it('is true for a firm with only a holding', async () => {
        findFirst.mockResolvedValue(
          investorRow({
            holdings: [{ company: company('helia', 'Helia', 'Fintech') }],
            _count: { holdings: 1, funds: 0 },
          }),
        );
        expect((await service.findOne('sequoia-capital')).indexable).toBe(true);
      });

      it('is true for a firm with only funds', async () => {
        findFirst.mockResolvedValue(
          investorRow({ funds: [fundRow()], _count: { holdings: 0, funds: 1 } }),
        );
        expect((await service.findOne('sequoia-capital')).indexable).toBe(true);
      });

      it('is true for a firm with only an officer', async () => {
        findFirst.mockResolvedValue(
          investorRow({
            people: [
              {
                id: 'pr-1',
                name: 'Jane Smith',
                role: 'Founder',
                since: 1972,
                prior: null,
                linkedinUrl: null,
                title: null,
                person: { slug: 'jane-smith', mergedIntoId: null, suppressedAt: null },
              },
            ],
          }),
        );
        expect((await service.findOne('sequoia-capital')).indexable).toBe(true);
      });

      it('is true for a limited partner with only fund commitments', async () => {
        findFirst.mockResolvedValue(investorRow({ _count: { commitments: 3 } }));
        expect((await service.findOne('sequoia-capital')).indexable).toBe(true);
      });
    });

    it('maps an LP commitment with its fund and manager, money as numbers', async () => {
      findFirst.mockResolvedValue(
        investorRow({
          commitments: [
            {
              id: 'c-1',
              amountUsd: 25_000_000n,
              amountLocal: 23_000_000n,
              currency: 'EUR',
              fund: {
                slug: 'fund-iv',
                name: 'Fund IV',
                vintageYear: 2019,
                strategy: 'Private equity',
                manager: { slug: 'acme-partners', name: 'Acme Partners' },
              },
            },
          ],
          _count: { commitments: 40 },
        }),
      );
      const res = await service.findOne('sequoia-capital');
      expect(res.commitments).toEqual([
        {
          id: 'c-1',
          fund: { slug: 'fund-iv', name: 'Fund IV', vintageYear: 2019, strategy: 'Private equity' },
          manager: { slug: 'acme-partners', name: 'Acme Partners' },
          amountUsd: 25_000_000,
          amountLocal: 23_000_000,
          currency: 'EUR',
        },
      ]);
      expect(res.commitmentCount).toBe(40);
    });

    it('caps the people list and reports the total', async () => {
      findFirst.mockResolvedValue(investorRow({ _count: { people: 4_000 } }));
      const res = await service.findOne('sequoia-capital');
      expect(res.peopleCount).toBe(4_000);
      const include = (findFirst.mock.calls[0]![0] as { include: { people: { take: number } } }).include;
      expect(include.people.take).toBe(60);
    });
  });

  describe('the read gate', () => {
    const signedOut = { unlocked: false, signedIn: false, unlockedUntil: null };
    const locked = { unlocked: false, signedIn: true, unlockedUntil: null };
    const as = (access: typeof signedOut) =>
      new InvestorsService((service as unknown as { prisma: PrismaService }).prisma, {
        accessFor: async () => access,
      } as unknown as UsersService);

    it('keeps partner-only firms, partner values and partner holdings out of a signed-out list', async () => {
      count.mockResolvedValue(1);
      findMany.mockResolvedValue([investorRow({ description: 'PARTNER-PROSE', partnerFields: ['description'] })]);
      const { items } = await service.findAll({ type: 'Venture' });

      const args = findMany.mock.calls[0]![0] as { where: Record<string, unknown>; include: { holdings: { where: Record<string, unknown> } } };
      expect(args.where).toMatchObject({ partnerOnly: false, type: 'Venture', AND: [{ NOT: { partnerFields: { has: 'type' } } }] });
      expect(args.include.holdings.where).toMatchObject({
        OR: [{ externalSource: null }, { externalSource: { not: 'PARTNER' } }],
        company: { partnerOnly: false },
      });
      expect(items[0]).toMatchObject({ description: null, masked: ['description'] });
    });

    it('previews the open sections and hides the LP commitments from a signed-out viewer', async () => {
      findFirst.mockResolvedValue(investorRow({ _count: { holdings: 40, commitments: 3 } }));
      const res = await as(signedOut).findOne('sequoia-capital');
      const include = (findFirst.mock.calls[0]![0] as { include: Record<string, { take?: number; where: unknown }> }).include;

      expect(include.holdings!.take).toBe(2);
      expect(include.people!.take).toBe(2);
      expect(include.funds!.take).toBe(2);
      expect(include.commitments!.take).toBe(0);
      expect(include.people!.where).toMatchObject({ OR: [{ externalSource: null }, { externalSource: { not: 'PARTNER' } }] });
      // Counts are over everything.
      expect(res.portfolioCount).toBe(40);
      expect(res.commitmentCount).toBe(3);
      expect(res.access).toMatchObject({ signedIn: false, previewLimit: 2 });
    });

    it('previews the commitments to a signed-in viewer, partner rows included', async () => {
      findFirst.mockResolvedValue(investorRow());
      await as(locked).findOne('sequoia-capital');
      const include = (findFirst.mock.calls[0]![0] as { include: Record<string, { take?: number; where: Record<string, unknown> }> }).include;
      expect(include.commitments!.take).toBe(2);
      expect(include.commitments!.where).not.toHaveProperty('OR');
    });

    it('returns a stub of a partner-only firm to a signed-out viewer', async () => {
      findFirst.mockResolvedValue(
        investorRow({
          partnerOnly: true,
          partnerFields: ['hq', 'description'],
          description: 'PARTNER-PROSE',
          _count: { people: 12 },
        }),
      );
      const res = await as(signedOut).findOne('sequoia-capital');
      expect(res).toMatchObject({
        name: 'Sequoia Capital',
        domain: 'sequoiacap.com',
        partnerOnly: true,
        hq: null,
        people: [],
        peopleCount: 12,
        indexable: false,
        citations: [],
      });
      expect(res.identifiers).toBeUndefined();
      expect(JSON.stringify(res)).not.toContain('PARTNER-PROSE');
      expect(JSON.stringify(res)).not.toContain('Menlo Park');
    });

    it('is never indexable for a partner-only firm, whoever views it', async () => {
      findFirst.mockResolvedValue(investorRow({ partnerOnly: true, _count: { holdings: 5 } }));
      await expect(service.findOne('sequoia-capital')).resolves.toMatchObject({ indexable: false });
    });
  });

  describe('listSlugs', () => {
    it('returns approved slugs with ISO timestamps for the sitemap', async () => {
      findMany.mockResolvedValue([
        { slug: 'sequoia-capital', updatedAt: new Date('2026-08-02T13:11:06.356Z') },
      ]);

      await expect(service.listSlugs()).resolves.toEqual([
        { slug: 'sequoia-capital', updatedAt: '2026-08-02T13:11:06.356Z' },
      ]);
      expect(findMany.mock.calls[0]![0]).toMatchObject({
        where: { moderationStatus: 'APPROVED', mergedIntoId: null, partnerOnly: false },
      });
    });

    it('lists only firms with a holding, fund, officer or commitment — on the filters findOne counts', async () => {
      findMany.mockResolvedValue([]);
      await service.listSlugs();
      findFirst.mockResolvedValue(investorRow());
      await service.findOne('sequoia-capital');

      const where = (findMany.mock.calls[0]![0] as { where: { OR: unknown[] } }).where;
      // The filter each detail count used, minus the firm-id key it adds.
      const counted = (m: jest.Mock, fk: string) => {
        const w = { ...((m.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> }).where };
        delete w[fk];
        return w;
      };
      // A firm can't be indexable on a row its page doesn't show.
      expect(where.OR).toEqual([
        { holdings: { some: counted(relationCounts.holdings, 'investorId') } },
        { funds: { some: counted(relationCounts.funds, 'managerId') } },
        { people: { some: counted(relationCounts.people, 'investorId') } },
        { commitments: { some: counted(relationCounts.commitments, 'investorId') } },
      ]);
    });
  });
});

describe('InvestorsService.proposeChange', () => {
  function serviceWith(firm: Record<string, unknown> | null) {
    const findFirst = jest.fn(async () => firm);
    const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'ip1',
      moderationStatus: args.data.moderationStatus,
    }));
    const prisma = {
      investor: { findFirst },
      investorChangeProposal: { create },
    } as unknown as PrismaService;
    return { service: new InvestorsService(prisma, unlockedUsers), findFirst, create };
  }

  const input = (changes: Record<string, unknown>) =>
    ({ changes, attested: true, sourceUrl: 'https://sec.gov/x' }) as never;

  it('stores only the keys that differ from the firm, PENDING, with the source', async () => {
    const { service, create } = serviceWith(investorRow());
    const result = await service.proposeChange(
      'sequoia-capital',
      input({ name: 'Sequoia Capital', hq: 'Menlo Park', domain: 'https://www.Sequoia.com/' }),
      'u1',
    );
    expect(result).toEqual({ id: 'ip1', moderationStatus: 'PENDING' });
    expect(create).toHaveBeenCalledWith({
      data: {
        investorId: 'i-1',
        changes: { hq: 'Menlo Park', domain: 'sequoia.com' },
        note: null,
        sourceUrl: 'https://sec.gov/x',
        moderationStatus: 'PENDING',
        submittedById: 'u1',
      },
    });
  });

  it('answers 400 when nothing would change', async () => {
    const { service, create } = serviceWith(investorRow());
    await expect(
      service.proposeChange(
        'sequoia-capital',
        input({ name: 'Sequoia Capital', domain: 'SEQUOIACAP.com' }),
        'u1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('answers 404 for a hidden or merged-away firm, looking only at public rows', async () => {
    const { service, findFirst } = serviceWith(null);
    await expect(
      service.proposeChange('gone', input({ hq: 'x' }), 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith({
      where: { slug: 'gone', moderationStatus: 'APPROVED', mergedIntoId: null },
    });
  });
});
