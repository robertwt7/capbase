import { describe, it, expect, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';

import { IngestService, normalizeFundName, normalizeInvestorName, normalizeName } from './ingest.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  IngestionSource,
  NormalizedFund,
  NormalizedInvestorFirm,
  NormalizedRecord,
} from '../sources/ingestion-source';

/** A full company row as the enrich path reads it back. */
function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-sec',
    slug: 'acme-robotics-inc-000123',
    name: 'Acme Robotics, Inc.',
    domain: '',
    websiteUrl: null,
    linkedinUrl: null,
    primarySector: null,
    oneLiner: 'Private securities offering disclosed via SEC Form D.',
    description: 'Acme Robotics, Inc. filed a Form D notice of exempt offering with the SEC.',
    hq: 'San Francisco, CALIFORNIA',
    founded: 0,
    headcount: 0,
    industry: ['Other Technology'],
    status: 'Private',
    stage: 'Series A',
    totalRaisedUsd: 7_500_000n,
    externalSource: 'SEC_EDGAR',
    externalId: '0001',
    mergedIntoId: null,
    ...overrides,
  };
}

/** An Investor row as the enrich path reads it back. */
function investorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i-1',
    slug: 'big-fund',
    name: 'Big Fund',
    legalName: null,
    type: 'Venture',
    hq: null,
    websiteUrl: null,
    linkedinUrl: null,
    domain: null,
    description: null,
    crdNumber: null,
    cikNumber: null,
    fundCount: null,
    assetsUsd: null,
    foundedYear: null,
    externalSource: null,
    externalId: null,
    mergedIntoId: null,
    ...overrides,
  };
}

/** A Fund row as loadFundIndex and the enrich path read it back. */
function fundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f-1',
    name: 'Big Fund I, L.P.',
    managerId: 'i-1',
    strategy: null,
    vintageYear: null,
    targetUsd: null,
    closedUsd: null,
    grossAssetsUsd: null,
    currency: 'USD',
    hq: null,
    secFundId: null,
    cikNumber: null,
    externalSource: null,
    externalId: null,
    ...overrides,
  };
}

interface IdentifierRow {
  scheme: string;
  value: string;
  entityType: string;
  entityId: string;
  source: string;
}

interface CandidateRow {
  id: string;
  entityType: string;
  leftId: string;
  rightId: string;
  signal: string;
  evidence: string;
  status: string;
}

type IdentifierWhere = {
  where: { scheme_value_entityType: { scheme: string; value: string; entityType: string } };
};

type CandidateWhere = {
  where: { entityType_leftId_rightId: { entityType: string; leftId: string; rightId: string } };
};

function mockPrisma(
  existing: ReturnType<typeof companyRow>[] = [],
  existingInvestors: ReturnType<typeof investorRow>[] = [],
  existingFunds: ReturnType<typeof fundRow>[] = [],
  seedIdentifiers: IdentifierRow[] = [],
) {
  let created = 0;
  let fundsCreated = 0;
  const identifiers: IdentifierRow[] = [...seedIdentifiers];
  const candidates: CandidateRow[] = [];
  return {
    identifiers,
    candidates,
    fund: {
      findMany: jest.fn<(args: unknown) => Promise<unknown[]>>(async () => existingFunds),
      findUnique: jest.fn<(args: { where: { id: string } }) => Promise<unknown>>(
        async (args) => existingFunds.find((f) => f.id === args.where.id) ?? null,
      ),
      update: jest.fn<(args: { where: { id: string } }) => Promise<unknown>>(async (args) => ({
        id: args.where.id,
      })),
      create: jest.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>(
        async () => ({ id: `f-new-${++fundsCreated}` }),
      ),
    },
    investor: {
      findMany: jest.fn<(args: unknown) => Promise<unknown[]>>(async () => existingInvestors),
      findUnique: jest.fn<(args: { where: { id: string } }) => Promise<unknown>>(
        async (args) => existingInvestors.find((i) => i.id === args.where.id) ?? null,
      ),
      update: jest.fn<(args: { where: { id: string } }) => Promise<unknown>>(async (args) => ({
        id: args.where.id,
      })),
      create: jest.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>(
        async () => ({ id: `i-new-${++created}` }),
      ),
    },
    company: {
      findMany: jest.fn<(args: unknown) => Promise<unknown[]>>(async () => existing),
      findUnique: jest.fn<(args: { where: { id: string } }) => Promise<unknown>>(
        async (args) => existing.find((c) => c.id === args.where.id) ?? null,
      ),
      update: jest.fn<(args: { where: { id: string } }) => Promise<unknown>>(async (args) => ({
        id: args.where.id,
      })),
      create: jest.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>(
        async () => ({ id: 'c-new' }),
      ),
    },
    fundingRound: {
      upsert: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
    },
    person: {
      upsert: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
    },
    investorHolding: {
      upsert: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
    },
    acquisitionDeal: {
      upsert: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
    },
    exitEvent: {
      upsert: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
    },
    revision: {
      createMany: jest.fn<(args: { data: Record<string, unknown>[] }) => Promise<unknown>>(
        async () => ({}),
      ),
    },
    // In-memory stand-ins that enforce the real unique keys, so the identifier
    // match and the collision path are exercised rather than mocked away.
    entityIdentifier: {
      findMany: jest.fn<(args: unknown) => Promise<unknown[]>>(async (args) => {
        const where = (args as { where: { entityType: string } }).where;
        return identifiers.filter((r) => r.entityType === where.entityType);
      }),
      findUnique: jest.fn<(args: IdentifierWhere) => Promise<{ entityId: string } | null>>(
        async (args) => {
          const k = args.where.scheme_value_entityType;
          const hit = identifiers.find(
            (r) => r.scheme === k.scheme && r.value === k.value && r.entityType === k.entityType,
          );
          return hit ? { entityId: hit.entityId } : null;
        },
      ),
      create: jest.fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>(
        async (args) => {
          identifiers.push(args.data as unknown as IdentifierRow);
          return args.data;
        },
      ),
    },
    mergeCandidate: {
      findUnique: jest.fn<(args: CandidateWhere) => Promise<CandidateRow | null>>(async (args) => {
        const k = args.where.entityType_leftId_rightId;
        return (
          candidates.find(
            (c) =>
              c.entityType === k.entityType && c.leftId === k.leftId && c.rightId === k.rightId,
          ) ?? null
        );
      }),
      create: jest.fn<(args: { data: Record<string, unknown> }) => Promise<unknown>>(
        async (args) => {
          const row = {
            id: `cand-${candidates.length + 1}`,
            status: 'PENDING',
            ...args.data,
          } as unknown as CandidateRow;
          candidates.push(row);
          return row;
        },
      ),
      update: jest.fn<
        (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
      >(async (args) => {
        const row = candidates.find((c) => c.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return row;
      }),
    },
    // The array form of $transaction: the mocked members return plain promises,
    // so awaiting them all is a faithful stand-in.
    $transaction: jest.fn<(ops: Promise<unknown>[]) => Promise<unknown[]>>((ops) =>
      Promise.all(ops),
    ),
  };
}

/** ConfigService stand-in: `env` supplies the vars the service reads. */
function config(env: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

/** Every revision row written across all $transaction calls, flattened. */
function revisionsFrom(prisma: ReturnType<typeof mockPrisma>): Record<string, unknown>[] {
  return prisma.revision.createMany.mock.calls.flatMap((call) => call[0].data);
}

function stubSource(
  records: NormalizedRecord[],
  firms?: NormalizedInvestorFirm[],
  funds?: NormalizedFund[],
): IngestionSource {
  return {
    name: 'STUB',
    fetch: async () => records,
    ...(firms ? { fetchInvestors: async () => firms } : {}),
    ...(funds ? { fetchFunds: async () => funds } : {}),
  };
}

function firm(overrides: Partial<NormalizedInvestorFirm> = {}): NormalizedInvestorFirm {
  return {
    externalId: '123456',
    name: 'Next Coast Ventures',
    type: 'Venture',
    hq: 'Austin, TX, United States',
    websiteUrl: 'https://www.nextcoastventures.com',
    domain: 'nextcoastventures.com',
    crdNumber: '123456',
    fundCount: 7,
    assetsUsd: 430_428_863,
    ...overrides,
  };
}

function record(overrides: Partial<NormalizedRecord> = {}): NormalizedRecord {
  return {
    source: 'STUB',
    companyExternalId: 'X1',
    company: {
      name: 'Acme Robotics, Inc.',
      hq: 'San Francisco, CALIFORNIA',
      foundedYear: 2021,
      industry: ['Other Technology'],
      stage: 'Series A',
      totalRaisedUsd: 7_500_000,
    },
    ...overrides,
  };
}

function serviceWith(
  prisma: ReturnType<typeof mockPrisma>,
  records: NormalizedRecord[],
  env: Record<string, string> = {},
) {
  return new IngestService(prisma as unknown as PrismaService, [stubSource(records)], config(env));
}

const RUN = { days: 7, limit: 100 };

describe('IngestService.run', () => {
  it('creates a new company with provenance and auto-APPROVED status', async () => {
    const prisma = mockPrisma();
    await serviceWith(prisma, [record()]).run(RUN);

    expect(prisma.company.create).toHaveBeenCalledTimes(1);
    const created = prisma.company.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({
      slug: 'acme-robotics-inc',
      name: 'Acme Robotics, Inc.',
      externalSource: 'STUB',
      externalId: 'X1',
      moderationStatus: 'APPROVED',
      status: 'Private',
      totalRaisedUsd: 7_500_000n,
    });
  });

  it('skips the round upsert when the record has no rounds', async () => {
    const prisma = mockPrisma();
    await serviceWith(prisma, [record()]).run(RUN);
    expect(prisma.fundingRound.upsert).not.toHaveBeenCalled();
  });

  it('upserts each round keyed by (source, round.externalId), defaulting to Equity', async () => {
    const prisma = mockPrisma();
    const r = record({
      rounds: [
        {
          externalId: 'acc-1',
          name: 'Private placement (Form D)',
          date: '2026-06-15',
          amountUsd: 7_500_000,
        },
      ],
    });
    await serviceWith(prisma, [r]).run(RUN);

    expect(prisma.fundingRound.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          externalSource_externalId: {
            externalSource: 'STUB',
            externalId: 'acc-1',
          },
        },
        create: expect.objectContaining({
          companyId: 'c-new',
          moderationStatus: 'APPROVED',
          amountUsd: 7_500_000n,
          kind: 'Equity',
        }),
        update: expect.objectContaining({ kind: 'Equity' }),
      }),
    );
  });

  it('upserts every round of a record without re-running the company upsert', async () => {
    // One SBIR grantee wins many awards; one Reg CF issuer runs several
    // offerings. A record per round would let the last one clobber the company.
    const prisma = mockPrisma();
    const r = record({
      rounds: [
        { externalId: 'a-1', name: 'SBIR Phase I award (NASA)', date: '2019-03-01', amountUsd: 125_000, kind: 'Grant' },
        { externalId: 'a-2', name: 'SBIR Phase II award (NASA)', date: '2021-07-01', amountUsd: 750_000, kind: 'Grant' },
      ],
    });
    await serviceWith(prisma, [r]).run(RUN);

    expect(prisma.company.create).toHaveBeenCalledTimes(1);
    expect(prisma.fundingRound.upsert).toHaveBeenCalledTimes(2);
    const kinds = prisma.fundingRound.upsert.mock.calls.map(
      (call) => (call[0] as { create: { kind: string } }).create.kind,
    );
    expect(kinds).toEqual(['Grant', 'Grant']);
  });

  it('upserts people, investors, acquisitions and exits with provenance keys', async () => {
    const prisma = mockPrisma();
    const r = record({
      people: [
        {
          externalId: 'X1:person:jane',
          name: 'Jane Founder',
          role: 'Executive Officer',
          since: 2026,
          title: 'CEO',
        },
      ],
      investors: [
        {
          externalId: 'X1:investor:q9',
          name: 'Big Fund',
          type: 'Venture',
          firstRound: 'Undisclosed',
          rounds: 1,
        },
      ],
      acquisitions: [
        {
          externalId: 'X1:acq:q8',
          target: 'Small Co',
          date: '2024-01-02',
          amountUsd: null,
          rationale: 'Tuck-in.',
        },
      ],
      exits: [
        {
          externalId: 'X1:exit:ipo',
          type: 'IPO',
          date: '2025-05-05',
          valueUsd: 1_000_000_000,
          detail: 'Initial public offering.',
        },
      ],
    });
    await serviceWith(prisma, [r]).run(RUN);

    expect(prisma.person.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          externalSource_externalId: {
            externalSource: 'STUB',
            externalId: 'X1:person:jane',
          },
        },
        create: expect.objectContaining({
          companyId: 'c-new',
          name: 'Jane Founder',
          role: 'Executive Officer',
          title: 'CEO',
          moderationStatus: 'APPROVED',
        }),
        update: { role: 'Executive Officer', title: 'CEO' },
      }),
    );
    expect(prisma.investorHolding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          name: 'Big Fund',
          type: 'Venture',
          moderationStatus: 'APPROVED',
        }),
      }),
    );
    expect(prisma.acquisitionDeal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          target: 'Small Co',
          amountUsd: null,
          moderationStatus: 'APPROVED',
        }),
      }),
    );
    expect(prisma.exitEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          type: 'IPO',
          valueUsd: 1_000_000_000n,
          moderationStatus: 'APPROVED',
        }),
      }),
    );
  });

  it('updates (not enriches) a row that already carries the same provenance key', async () => {
    const prisma = mockPrisma([companyRow({ externalSource: 'STUB', externalId: 'X1' })]);
    await serviceWith(prisma, [record()]).run(RUN);

    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-sec' },
        data: expect.objectContaining({
          name: 'Acme Robotics, Inc.',
          stage: 'Series A',
        }),
      }),
    );
  });

  it('filters sources by name when opts.sources is provided', async () => {
    const prisma = mockPrisma();
    const service = new IngestService(
      prisma as unknown as PrismaService,
      [stubSource([record()])],
      config(),
    );
    const result = await service.run({ ...RUN, sources: ['OTHER'] });
    expect(result).toEqual({ processed: 0, upserted: 0, investors: 0, funds: 0 });
    expect(prisma.company.create).not.toHaveBeenCalled();
  });
});

describe('IngestService match-&-enrich', () => {
  it('enriches a same-name row: fills blanks, replaces placeholder copy, never touches identity fields', async () => {
    const prisma = mockPrisma([companyRow()]);
    const r = record({
      source: 'WIKIDATA',
      companyExternalId: 'Q42',
      company: {
        name: 'Acme Robotics',
        hq: 'San Francisco, United States',
        foundedYear: 2019,
        industry: ['robotics'],
        stage: 'Late stage',
        totalRaisedUsd: 0,
        domain: 'acme.com',
        websiteUrl: 'https://acme.com',
        linkedinUrl: 'https://www.linkedin.com/company/acme',
        primarySector: 'Enterprise SaaS',
        oneLiner: 'Industrial robotics company.',
        description: 'Acme Robotics builds industrial robots.',
        headcount: 500,
      },
      people: [
        {
          externalId: 'Q42:person:q7:CEO',
          name: 'Jane Founder',
          role: 'CEO',
          since: 2019,
        },
      ],
    });
    await serviceWith(prisma, [r]).run(RUN);

    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(prisma.company.update).toHaveBeenCalledTimes(1);
    const { where, data } = prisma.company.update.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(where).toEqual({ id: 'c-sec' });
    expect(data).toEqual({
      domain: 'acme.com',
      websiteUrl: 'https://acme.com',
      linkedinUrl: 'https://www.linkedin.com/company/acme',
      primarySector: 'Enterprise SaaS',
      founded: 2019,
      headcount: 500,
      oneLiner: 'Industrial robotics company.',
      description: 'Acme Robotics builds industrial robots.',
    });
    // Children still attach to the matched row, with the enriching source's provenance.
    expect(prisma.person.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          externalSource_externalId: {
            externalSource: 'WIKIDATA',
            externalId: 'Q42:person:q7:CEO',
          },
        },
        create: expect.objectContaining({ companyId: 'c-sec' }),
      }),
    );
  });

  it('keeps human-written copy: only SEC placeholder text is replaced', async () => {
    const prisma = mockPrisma([
      companyRow({
        oneLiner: 'Hand-written pitch.',
        description: 'Curated description.',
      }),
    ]);
    const r = record({
      source: 'WIKIDATA',
      companyExternalId: 'Q42',
      company: {
        ...record().company,
        name: 'Acme Robotics',
        domain: 'acme.com',
        oneLiner: 'Wikidata one-liner.',
        description: 'Wikidata description.',
      },
    });
    await serviceWith(prisma, [r]).run(RUN);

    const { data } = prisma.company.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data.domain).toBe('acme.com');
    expect(data).not.toHaveProperty('oneLiner');
    expect(data).not.toHaveProperty('description');
  });

  it('matches by domain even when names differ', async () => {
    const prisma = mockPrisma([companyRow({ domain: 'acme.com', name: 'Totally Different Name' })]);
    const r = record({
      source: 'WIKIDATA',
      companyExternalId: 'Q42',
      company: {
        ...record().company,
        name: 'Acme Robotics',
        domain: 'acme.com',
      },
    });
    await serviceWith(prisma, [r]).run(RUN);
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it('skips the update entirely when there is nothing to fill', async () => {
    const prisma = mockPrisma([
      companyRow({
        domain: 'acme.com',
        websiteUrl: 'https://acme.com',
        linkedinUrl: 'https://www.linkedin.com/company/acme',
        primarySector: 'Enterprise SaaS',
        founded: 2019,
        headcount: 500,
        oneLiner: 'Hand-written pitch.',
        description: 'Curated description.',
      }),
    ]);
    const r = record({
      source: 'WIKIDATA',
      companyExternalId: 'Q42',
      company: {
        ...record().company,
        name: 'Acme Robotics',
        domain: 'acme.com',
        headcount: 900,
      },
    });
    await serviceWith(prisma, [r]).run(RUN);
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('records one revision per field the enrichment fills', async () => {
    const prisma = mockPrisma([companyRow()]);
    const r = record({
      source: 'WIKIDATA',
      companyExternalId: 'Q42',
      company: {
        ...record().company,
        name: 'Acme Robotics',
        domain: 'acme.com',
        primarySector: 'Enterprise SaaS',
      },
    });
    await serviceWith(prisma, [r]).run(RUN);

    const rows = revisionsFrom(prisma);
    expect(rows.map((row) => row.field).sort()).toEqual(['domain', 'founded', 'primarySector']);
    expect(rows).toContainEqual(
      expect.objectContaining({
        companyId: 'c-sec',
        entityType: 'company',
        entityId: 'c-sec',
        field: 'domain',
        before: '',
        after: 'acme.com',
        action: 'UPDATE',
        actor: 'INGEST',
        actorSource: 'WIKIDATA',
      }),
    );
    // The update and its revisions commit together.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('writes no revisions when INGEST_RECORD_REVISIONS=false', async () => {
    const prisma = mockPrisma([companyRow()]);
    const r = record({
      source: 'WIKIDATA',
      companyExternalId: 'Q42',
      company: {
        ...record().company,
        name: 'Acme Robotics',
        domain: 'acme.com',
      },
    });
    await serviceWith(prisma, [r], { INGEST_RECORD_REVISIONS: 'false' }).run(RUN);

    expect(prisma.company.update).toHaveBeenCalledTimes(1);
    expect(prisma.revision.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('records the own-key update, but only for fields that actually move', async () => {
    // hq/industry/stage are unchanged; only the raise total and name differ.
    const prisma = mockPrisma([companyRow({ externalSource: 'STUB', externalId: 'X1' })]);
    const r = record({
      company: { ...record().company, totalRaisedUsd: 9_000_000 },
    });
    await serviceWith(prisma, [r]).run(RUN);

    const rows = revisionsFrom(prisma);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      field: 'totalRaisedUsd',
      before: 7_500_000,
      after: 9_000_000,
      actor: 'INGEST',
      actorSource: 'STUB',
    });
  });

  it('skips the transaction when an own-key update changes nothing', async () => {
    const prisma = mockPrisma([companyRow({ externalSource: 'STUB', externalId: 'X1' })]);
    await serviceWith(prisma, [record()]).run(RUN);

    expect(prisma.company.update).toHaveBeenCalledTimes(1);
    expect(prisma.revision.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('appends the external id to the slug on collision', async () => {
    const prisma = mockPrisma([
      companyRow({
        id: 'c-other',
        slug: 'acme',
        name: 'Acme Capital Partners',
        domain: 'other.com',
      }),
    ]);
    const r = record({
      source: 'WIKIDATA',
      companyExternalId: 'Q42',
      company: { ...record().company, name: 'Acme' },
    });
    await serviceWith(prisma, [r]).run(RUN);

    expect(prisma.company.create).toHaveBeenCalledTimes(1);
    const created = prisma.company.create.mock.calls[0]![0].data;
    expect(created.slug).toBe('acme-q42');
  });
});

describe('IngestService investor firms', () => {
  function serviceWithFirms(
    prisma: ReturnType<typeof mockPrisma>,
    firms: NormalizedInvestorFirm[],
    records: NormalizedRecord[] = [],
  ) {
    return new IngestService(
      prisma as unknown as PrismaService,
      [stubSource(records, firms)],
      config(),
    );
  }

  it('creates a standalone investor with provenance and no holding', async () => {
    const prisma = mockPrisma();
    const result = await serviceWithFirms(prisma, [firm()]).run(RUN);

    expect(result.investors).toBe(1);
    expect(prisma.investorHolding.upsert).not.toHaveBeenCalled();
    expect(prisma.investor.create).toHaveBeenCalledTimes(1);
    expect(prisma.investor.create.mock.calls[0]![0].data).toMatchObject({
      slug: 'next-coast-ventures',
      name: 'Next Coast Ventures',
      type: 'Venture',
      domain: 'nextcoastventures.com',
      crdNumber: '123456',
      fundCount: 7,
      assetsUsd: 430_428_863n,
      externalSource: 'STUB',
      externalId: '123456',
      moderationStatus: 'APPROVED',
    });
  });

  it('updates its own provenance-keyed row instead of creating a duplicate', async () => {
    const prisma = mockPrisma(
      [],
      [
        investorRow({
          id: 'i-adv',
          externalSource: 'STUB',
          externalId: '123456',
        }),
      ],
    );
    await serviceWithFirms(prisma, [firm({ fundCount: 9 })]).run(RUN);

    expect(prisma.investor.create).not.toHaveBeenCalled();
    expect(prisma.investor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'i-adv' },
        data: expect.objectContaining({
          name: 'Next Coast Ventures',
          fundCount: 9,
        }),
      }),
    );
  });

  it('matches an existing investor by domain and only fills blanks', async () => {
    const prisma = mockPrisma(
      [],
      [
        investorRow({
          id: 'i-wd',
          name: 'Next Coast',
          type: 'Growth',
          domain: 'nextcoastventures.com',
          hq: 'Austin',
        }),
      ],
    );
    await serviceWithFirms(prisma, [firm()]).run(RUN);

    expect(prisma.investor.create).not.toHaveBeenCalled();
    const data = prisma.investor.update.mock.calls[0]![0].data as Record<string, unknown>;
    // Blank fields filled…
    expect(data).toMatchObject({ crdNumber: '123456', fundCount: 7 });
    // …but nothing already set is touched, and never name/type.
    expect(data.hq).toBeUndefined();
    expect(data.name).toBeUndefined();
    expect(data.type).toBeUndefined();
  });

  it('does not merge ADV false friends into a different firm of a similar name', async () => {
    // Both are real SEC ADV rows. Neither may collapse into Sequoia Capital.
    const prisma = mockPrisma(
      [],
      [
        investorRow({
          id: 'i-seq',
          name: 'Sequoia Capital',
          domain: 'sequoiacap.com',
        }),
      ],
    );
    await serviceWithFirms(prisma, [
      firm({
        externalId: '111',
        name: 'Sequoia Planning & Investments LLC',
        websiteUrl: null,
        domain: null,
      }),
      firm({
        externalId: '222',
        name: 'Benchmark Capital Group Ltd.',
        websiteUrl: null,
        domain: null,
      }),
    ]).run(RUN);

    expect(prisma.investor.create).toHaveBeenCalledTimes(2);
    expect(prisma.investor.update).not.toHaveBeenCalled();
  });

  it('links a holding to a newly minted investor row', async () => {
    const prisma = mockPrisma();
    const r = record({
      investors: [
        {
          externalId: 'X1:investor:Q20',
          investorExternalId: 'Q20',
          name: 'Big Fund',
          type: 'Venture',
          firstRound: 'Undisclosed',
          rounds: 1,
        },
      ],
    });
    await serviceWithFirms(prisma, [], [r]).run(RUN);

    expect(prisma.investor.create).toHaveBeenCalledTimes(1);
    expect(prisma.investor.create.mock.calls[0]![0].data).toMatchObject({
      slug: 'big-fund',
      externalSource: 'STUB',
      externalId: 'Q20',
    });
    expect(prisma.investorHolding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          investorId: 'i-new-1',
          name: 'Big Fund',
        }),
        update: expect.objectContaining({ investorId: 'i-new-1' }),
      }),
    );
  });

  it('reuses one investor row across holdings at different companies', async () => {
    const prisma = mockPrisma();
    const holding = (companyId: string) => ({
      externalId: `${companyId}:investor:Q20`,
      investorExternalId: 'Q20',
      name: 'Big Fund',
      type: 'Venture' as const,
      firstRound: 'Undisclosed',
      rounds: 1,
    });
    await serviceWithFirms(
      prisma,
      [],
      [
        record({ companyExternalId: 'A', investors: [holding('A')] }),
        record({ companyExternalId: 'B', investors: [holding('B')] }),
      ],
    ).run(RUN);

    expect(prisma.investor.create).toHaveBeenCalledTimes(1);
    expect(prisma.investorHolding.upsert).toHaveBeenCalledTimes(2);
  });

  it('drops an onlyIfKnown holding when no firm matches', async () => {
    // S-1 ownership rows carry no type signal, so an unmatched holder must not
    // become an Investor row typed from its name.
    const prisma = mockPrisma();
    const r = record({
      investors: [
        {
          externalId: 'X1:holder:some-family-trust',
          name: 'The Smith Family Trust',
          type: 'Venture',
          firstRound: 'Undisclosed',
          rounds: 0,
          onlyIfKnown: true,
        },
      ],
    });
    await serviceWithFirms(prisma, [], [r]).run(RUN);

    expect(prisma.investor.create).not.toHaveBeenCalled();
    expect(prisma.investorHolding.upsert).not.toHaveBeenCalled();
  });

  it('attaches an onlyIfKnown holding to a known firm, using the firm own type', async () => {
    const prisma = mockPrisma(
      [],
      [investorRow({ id: 'i-nea', name: 'New Enterprise Associates', type: 'Private equity' })],
    );
    const r = record({
      investors: [
        {
          externalId: 'X1:holder:new-enterprise-associates',
          name: 'New Enterprise Associates',
          // The source's guess, which the resolved firm's structural type beats.
          type: 'Venture',
          firstRound: 'Undisclosed',
          rounds: 0,
          onlyIfKnown: true,
        },
      ],
    });
    await serviceWithFirms(prisma, [], [r]).run(RUN);

    expect(prisma.investor.create).not.toHaveBeenCalled();
    expect(prisma.investorHolding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ investorId: 'i-nea', type: 'Private equity' }),
        update: expect.objectContaining({ investorId: 'i-nea', type: 'Private equity' }),
      }),
    );
  });

  it('never matches on a platform domain the source refused to publish', async () => {
    // Founders Fund and Menlo Ventures both list the same medium.com blog. The
    // parser strips the domain, so they must stay two distinct investors.
    const prisma = mockPrisma(
      [],
      [investorRow({ id: 'i-ff', name: 'Founders Fund', domain: null })],
    );
    await serviceWithFirms(prisma, [
      firm({
        externalId: '900',
        name: 'Menlo Ventures',
        websiteUrl: 'https://medium.com/@menlo',
        domain: null,
      }),
    ]).run(RUN);

    expect(prisma.investor.create).toHaveBeenCalledTimes(1);
    expect(prisma.investor.create.mock.calls[0]![0].data).toMatchObject({
      name: 'Menlo Ventures',
      domain: null,
      websiteUrl: 'https://medium.com/@menlo',
    });
  });

  it('suffixes the slug when one is already taken', async () => {
    const prisma = mockPrisma(
      [],
      [
        investorRow({
          id: 'i-other',
          slug: 'next-coast-ventures',
          name: 'Unrelated',
        }),
      ],
    );
    await serviceWithFirms(prisma, [firm()]).run(RUN);
    expect(prisma.investor.create.mock.calls[0]![0].data.slug).toBe('next-coast-ventures-123456');
  });

  it('keeps going when one firm fails to upsert', async () => {
    const prisma = mockPrisma();
    prisma.investor.create.mockRejectedValueOnce(new Error('unique violation'));
    const result = await serviceWithFirms(prisma, [
      firm({ externalId: '1', name: 'One' }),
      firm({ externalId: '2', name: 'Two' }),
    ]).run(RUN);

    expect(result.investors).toBe(1);
  });
});

describe('IngestService funds', () => {
  function serviceWithFunds(
    prisma: ReturnType<typeof mockPrisma>,
    funds: NormalizedFund[],
  ) {
    return new IngestService(
      prisma as unknown as PrismaService,
      [stubSource([], undefined, funds)],
      config(),
    );
  }

  function normalizedFund(overrides: Partial<NormalizedFund> = {}): NormalizedFund {
    return {
      externalId: '805-1534393064',
      name: 'Big Fund I, L.P.',
      managerCrd: '160489',
      strategy: 'Venture capital',
      grossAssetsUsd: 3_030_000_000,
      secFundId: '805-1534393064',
      ...overrides,
    };
  }

  const manager = (overrides: Record<string, unknown> = {}) =>
    investorRow({ id: 'i-a16z', slug: 'a16z', name: 'Andreessen Horowitz', crdNumber: '160489', ...overrides });

  it('creates a fund against the manager resolved from its CRD', async () => {
    const prisma = mockPrisma([], [manager()]);
    const result = await serviceWithFunds(prisma, [normalizedFund()]).run(RUN);

    expect(result.funds).toBe(1);
    expect(prisma.fund.create).toHaveBeenCalledTimes(1);
    expect(prisma.fund.create.mock.calls[0]![0].data).toMatchObject({
      managerId: 'i-a16z',
      name: 'Big Fund I, L.P.',
      strategy: 'Venture capital',
      grossAssetsUsd: 3_030_000_000n,
      secFundId: '805-1534393064',
      externalSource: 'STUB',
      externalId: '805-1534393064',
      moderationStatus: 'APPROVED',
    });
  });

  it('resolves the manager by crdNumber, not by ADV provenance', async () => {
    // Andreessen Horowitz's row was created by Wikidata and later enriched with
    // a CRD; it carries no SEC_ADV (externalSource, externalId) at all.
    const prisma = mockPrisma([], [manager({ externalSource: 'WIKIDATA', externalId: 'Q4756075' })]);
    await serviceWithFunds(prisma, [normalizedFund()]).run(RUN);

    expect(prisma.fund.create.mock.calls[0]![0].data).toMatchObject({ managerId: 'i-a16z' });
  });

  it('skips a fund whose manager cannot be resolved rather than writing a null one', async () => {
    const prisma = mockPrisma([], []);
    const result = await serviceWithFunds(prisma, [normalizedFund()]).run(RUN);

    expect(result.funds).toBe(0);
    expect(prisma.fund.create).not.toHaveBeenCalled();
    expect(prisma.fund.update).not.toHaveBeenCalled();
  });

  it('skips a Form D fund with no CRD and no name match', async () => {
    const prisma = mockPrisma([], [manager()]);
    const result = await serviceWithFunds(prisma, [
      normalizedFund({
        externalId: '0001234567',
        name: 'Unknown Ventures Fund III, L.P.',
        managerCrd: null,
        strategy: 'Venture capital',
        vintageYear: 2023,
        secFundId: null,
        grossAssetsUsd: null,
      }),
    ]).run(RUN);

    expect(result.funds).toBe(0);
    expect(prisma.fund.create).not.toHaveBeenCalled();
  });

  it('updates its own provenance-keyed row and never writes the source blanks', async () => {
    const prisma = mockPrisma(
      [],
      [manager()],
      [fundRow({ id: 'f-adv', externalSource: 'STUB', externalId: '805-1534393064', vintageYear: 2019 })],
    );
    await serviceWithFunds(prisma, [normalizedFund()]).run(RUN);

    expect(prisma.fund.create).not.toHaveBeenCalled();
    const data = prisma.fund.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ name: 'Big Fund I, L.P.', grossAssetsUsd: 3_030_000_000n });
    // The Form D vintage already on the row survives an ADV re-run.
    expect(data).not.toHaveProperty('vintageYear');
  });

  it('enriches a name-matched fund, filling only blank columns', async () => {
    const prisma = mockPrisma(
      [],
      [manager()],
      [fundRow({ id: 'f-adv', managerId: 'i-a16z', strategy: 'Private equity' })],
    );
    // A Form D filing for the same fund: no CRD, but vintage/target/closed.
    const result = await serviceWithFunds(prisma, [
      normalizedFund({
        externalId: '0001234567',
        name: 'BIG FUND I, L.P.',
        managerCrd: null,
        strategy: 'Venture capital',
        vintageYear: 2021,
        targetUsd: null,
        closedUsd: 250_000_000,
        grossAssetsUsd: null,
        secFundId: null,
        cikNumber: '0001234567',
      }),
    ]).run(RUN);

    expect(result.funds).toBe(1);
    expect(prisma.fund.create).not.toHaveBeenCalled();
    const data = prisma.fund.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ vintageYear: 2021, closedUsd: 250_000_000n, cikNumber: '0001234567' });
    // The strategy already recorded is not replaced by a name match.
    expect(data).not.toHaveProperty('strategy');
  });

  it('creates rather than merges when an ADV fund matches another manager\'s fund of the same name', async () => {
    const prisma = mockPrisma(
      [],
      [manager(), investorRow({ id: 'i-other', slug: 'other', name: 'Other Capital', crdNumber: '999999' })],
      [fundRow({ id: 'f-other', managerId: 'i-other', name: 'Big Fund I, L.P.' })],
    );
    await serviceWithFunds(prisma, [normalizedFund()]).run(RUN);

    expect(prisma.fund.update).not.toHaveBeenCalled();
    expect(prisma.fund.create.mock.calls[0]![0].data).toMatchObject({ managerId: 'i-a16z' });
  });

  it('matches neither fund when two managers claim the same name', async () => {
    const prisma = mockPrisma(
      [],
      [manager()],
      [
        fundRow({ id: 'f-a', managerId: 'i-a', name: 'Fund 5' }),
        fundRow({ id: 'f-b', managerId: 'i-b', name: 'Fund 5' }),
      ],
    );
    // A Form D filing named "Fund 5" has no manager of its own, and the name is
    // ambiguous — so it resolves to nothing and is skipped, not mis-attributed.
    const result = await serviceWithFunds(prisma, [
      normalizedFund({ externalId: '0009', name: 'FUND 5', managerCrd: null, secFundId: null, grossAssetsUsd: null }),
    ]).run(RUN);

    expect(result.funds).toBe(0);
    expect(prisma.fund.update).not.toHaveBeenCalled();
    expect(prisma.fund.create).not.toHaveBeenCalled();
  });

  it('passes the known manager CRDs to a fund-producing source', async () => {
    const prisma = mockPrisma([], [manager()]);
    let seen: ReadonlySet<string> | undefined;
    const source: IngestionSource = {
      name: 'STUB',
      fetch: async () => [],
      fetchFunds: async (opts) => {
        seen = opts.knownManagerCrds;
        return [];
      },
    };
    await new IngestService(prisma as unknown as PrismaService, [source], config()).run(RUN);

    expect([...(seen ?? [])]).toEqual(['160489']);
  });
});

describe('normalizeFundName', () => {
  it('matches an ALL-CAPS ADV fund name to the Form D filing of the same fund', () => {
    expect(normalizeFundName('ANDREESSEN HOROWITZ FUND X-B, L.P.')).toBe(
      normalizeFundName('Andreessen Horowitz Fund X-B, L.P.'),
    );
  });

  it('keeps the roman numerals that distinguish vintages apart', () => {
    expect(normalizeFundName('Big Fund II, L.P.')).not.toBe(normalizeFundName('Big Fund III, L.P.'));
  });
});

describe('normalizeInvestorName', () => {
  it.each([
    ['Next Coast Ventures, LLC', 'next coast ventures'],
    ['468 Management GmbH', '468 management'],
    ['Andreessen Horowitz', 'andreessen horowitz'],
    ['ANDREESSEN HOROWITZ LP', 'andreessen horowitz'],
    ['A.Capital Ventures', 'a capital ventures'],
    ['Work-Bench Management, L.L.C.', 'work bench management'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeInvestorName(input)).toBe(expected);
  });

  it('keeps business words that distinguish real firms', () => {
    // All four are distinct firms; stripping business words would merge them.
    const keys = [
      'Greylock Partners',
      'Greylock Capital Management',
      'Sequoia Capital',
      'Sequoia Planning & Investments LLC',
    ].map(normalizeInvestorName);
    expect(new Set(keys).size).toBe(4);
  });

  it('matches the same firm across legal-form variations', () => {
    expect(normalizeInvestorName('Team8')).toBe(normalizeInvestorName('Team8 Ltd'));
    expect(normalizeInvestorName('F2 Capital')).toBe(normalizeInvestorName('F2 Capital LP'));
  });
});

describe('normalizeName', () => {
  it.each([
    ['Stripe, Inc.', 'stripe'],
    ['stripe', 'stripe'],
    ['ACME Corp.', 'acme'],
    ['Acme Holdings Co', 'acme holdings'],
    ['OpenAI, L.L.C.', 'openai'],
    ['SpaceX', 'spacex'],
    ['The Boring Company', 'the boring'],
    ['Company', 'company'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});

describe('IngestService identifier matching', () => {
  /** A company record with a name nothing else shares, so the only signals left
   *  are whatever the caller adds. `websiteUrl` is always present so a match
   *  produces a visible enrich update to assert on. */
  function anonymous(company: Partial<NormalizedRecord['company']> = {}): NormalizedRecord {
    return record({
      source: 'SEC_FORM_C',
      companyExternalId: '123',
      company: {
        name: 'Nothing Else Is Called This',
        hq: '',
        foundedYear: 0,
        industry: [],
        stage: 'Seed',
        totalRaisedUsd: 0,
        websiteUrl: 'https://filled-by-the-record.example',
        ...company,
      },
    });
  }

  it('enriches the row holding the same CIK instead of creating a second', async () => {
    // Company is unique on (externalSource, externalId), so SEC_EDGAR:123 and
    // SEC_FORM_C:123 are two legal rows for what is ONE filer. Before the
    // crosswalk nothing connected them.
    const prisma = mockPrisma(
      [companyRow()],
      [],
      [],
      [
        {
          scheme: 'CIK',
          value: '0000000123',
          entityType: 'company',
          entityId: 'c-sec',
          source: 'SEC_EDGAR',
        },
      ],
    );
    await serviceWith(prisma, [
      anonymous({ identifiers: [{ scheme: 'CIK', value: '123' }] }),
    ]).run(RUN);

    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(prisma.company.update.mock.calls[0]![0].where).toEqual({ id: 'c-sec' });
  });

  it('prefers the identifier over a conflicting domain match', async () => {
    // A domain is a strong inference; a CIK is the publisher's own statement.
    const prisma = mockPrisma(
      [
        companyRow(),
        companyRow({ id: 'c-domain', slug: 'other', name: 'Other Co', domain: 'acme.com' }),
      ],
      [],
      [],
      [
        {
          scheme: 'CIK',
          value: '0000000123',
          entityType: 'company',
          entityId: 'c-sec',
          source: 'SEC_EDGAR',
        },
      ],
    );
    await serviceWith(prisma, [
      anonymous({ domain: 'acme.com', identifiers: [{ scheme: 'CIK', value: '123' }] }),
    ]).run(RUN);

    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(prisma.company.update.mock.calls[0]![0].where).toEqual({ id: 'c-sec' });
  });

  it('falls back to domain then name when the record carries no identifiers', async () => {
    const prisma = mockPrisma([companyRow({ domain: 'acme.com' })]);
    await serviceWith(prisma, [anonymous({ domain: 'acme.com' })]).run(RUN);

    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(prisma.company.update.mock.calls[0]![0].where).toEqual({ id: 'c-sec' });
  });

  it('records a candidate rather than reassigning an identifier another row holds', async () => {
    const prisma = mockPrisma(
      [companyRow()],
      [],
      [],
      [
        {
          scheme: 'CIK',
          value: '0000000123',
          entityType: 'company',
          entityId: 'c-other',
          source: 'SEC_EDGAR',
        },
      ],
    );
    // Matches its OWN provenance row, but claims a CIK a different row holds.
    await serviceWith(prisma, [
      record({
        source: 'SEC_EDGAR',
        companyExternalId: '0001',
        company: {
          name: 'Acme Robotics, Inc.',
          hq: 'San Francisco, CALIFORNIA',
          foundedYear: 2021,
          industry: [],
          stage: 'Series A',
          totalRaisedUsd: 7_500_000,
          identifiers: [{ scheme: 'CIK', value: '123' }],
        },
      }),
    ]).run(RUN);

    expect(prisma.identifiers).toHaveLength(1);
    expect(prisma.identifiers[0]!.entityId).toBe('c-other');
    expect(prisma.candidates).toHaveLength(1);
    expect(prisma.candidates[0]).toMatchObject({
      entityType: 'company',
      leftId: 'c-other',
      rightId: 'c-sec',
      signal: 'identifier',
      evidence: 'CIK:0000000123',
    });
  });

  it('records a candidate when one record’s identifiers point at two rows', async () => {
    const prisma = mockPrisma(
      [
        companyRow({ id: 'c-a', slug: 'a', name: 'Alpha Corp' }),
        companyRow({
          id: 'c-b',
          slug: 'b',
          name: 'Beta Corp',
          externalSource: 'WIKIDATA',
          externalId: 'Q42',
        }),
      ],
      [],
      [],
      [
        { scheme: 'CIK', value: '0000000123', entityType: 'company', entityId: 'c-a', source: 'SEC_EDGAR' },
        { scheme: 'WIKIDATA', value: 'Q42', entityType: 'company', entityId: 'c-b', source: 'WIKIDATA' },
      ],
    );
    await serviceWith(prisma, [
      anonymous({
        identifiers: [
          { scheme: 'CIK', value: '123' },
          { scheme: 'WIKIDATA', value: 'Q42' },
        ],
      }),
    ]).run(RUN);

    // The first hit still wins — refusing to match would create a THIRD row for
    // the same entity — but the disagreement is queued for a human.
    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(prisma.company.update.mock.calls[0]![0].where).toEqual({ id: 'c-a' });
    expect(prisma.candidates).toHaveLength(1);
    expect(prisma.candidates[0]).toMatchObject({ leftId: 'c-a', rightId: 'c-b', signal: 'identifier' });
  });

  it('matches an investor firm on its CRD ahead of domain and name', async () => {
    const prisma = mockPrisma(
      [],
      [investorRow({ id: 'i-adv', name: 'Nothing Like The Incoming Name' })],
      [],
      [
        {
          scheme: 'CRD',
          value: '123456',
          entityType: 'investor',
          entityId: 'i-adv',
          source: 'SEC_ADV',
        },
      ],
    );
    const source = stubSource(
      [],
      [firm({ domain: null, identifiers: [{ scheme: 'CRD', value: '0000123456' }] })],
    );
    await new IngestService(prisma as unknown as PrismaService, [source], config()).run(RUN);

    expect(prisma.investor.create).not.toHaveBeenCalled();
    expect(prisma.investor.update.mock.calls[0]![0].where).toEqual({ id: 'i-adv' });
  });
});

describe('IngestService tombstones', () => {
  it('enriches the survivor when a record is keyed to a merged-away row', async () => {
    // This is the whole reason a merge keeps the losing row instead of deleting
    // it. Delete it and this record's (source, externalId) would miss, a fresh
    // row would be created, and the next cron run would undo the merge.
    const prisma = mockPrisma([
      companyRow({ id: 'c-lose', slug: 'acme-old', mergedIntoId: 'c-keep' }),
      companyRow({
        id: 'c-keep',
        slug: 'acme',
        name: 'Acme Robotics Holdings',
        externalId: '0002',
      }),
    ]);
    await serviceWith(prisma, [
      record({
        source: 'SEC_EDGAR',
        companyExternalId: '0001',
        company: {
          name: 'Acme Robotics, Inc.',
          hq: 'San Francisco, CALIFORNIA',
          foundedYear: 2021,
          industry: ['Other Technology'],
          stage: 'Series A',
          totalRaisedUsd: 9_000_000,
        },
      }),
    ]).run(RUN);

    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(prisma.company.update.mock.calls[0]![0].where).toEqual({ id: 'c-keep' });
  });

  it('follows a chain of merges to the row at the end of it', async () => {
    const prisma = mockPrisma([
      companyRow({ id: 'c-1', slug: 'a', mergedIntoId: 'c-2' }),
      companyRow({ id: 'c-2', slug: 'b', externalId: '0002', mergedIntoId: 'c-3' }),
      companyRow({ id: 'c-3', slug: 'c', name: 'Final Survivor', externalId: '0003' }),
    ]);
    await serviceWith(prisma, [
      record({
        source: 'SEC_EDGAR',
        companyExternalId: '0001',
        company: {
          name: 'Acme Robotics, Inc.',
          hq: 'San Francisco, CALIFORNIA',
          foundedYear: 2021,
          industry: ['Other Technology'],
          stage: 'Series A',
          totalRaisedUsd: 9_000_000,
        },
      }),
    ]).run(RUN);

    expect(prisma.company.update.mock.calls[0]![0].where).toEqual({ id: 'c-3' });
  });

  it('does not match onto a tombstone whose chain cycles', async () => {
    // A cycle cannot resolve to a live row, so the key matches nothing and the
    // record creates a fresh row rather than writing somewhere invisible.
    const prisma = mockPrisma([
      companyRow({ id: 'c-1', slug: 'a', mergedIntoId: 'c-2' }),
      companyRow({ id: 'c-2', slug: 'b', externalId: '0002', mergedIntoId: 'c-1' }),
    ]);
    await serviceWith(prisma, [
      record({
        source: 'SEC_EDGAR',
        companyExternalId: '0001',
        company: {
          name: 'Something Else Entirely',
          hq: '',
          foundedYear: 0,
          industry: [],
          stage: 'Seed',
          totalRaisedUsd: 0,
        },
      }),
    ]).run(RUN);

    expect(prisma.company.create).toHaveBeenCalledTimes(1);
  });

  it('resolves a merged-away investor the same way', async () => {
    const prisma = mockPrisma(
      [],
      [
        // Keyed to the stub source, so byKey is the signal under test.
        investorRow({
          id: 'i-lose',
          slug: 'old',
          externalSource: 'STUB',
          externalId: '123456',
          mergedIntoId: 'i-keep',
        }),
        investorRow({ id: 'i-keep', slug: 'new', name: 'Next Coast Ventures Management' }),
      ],
    );
    const source = stubSource([], [firm()]);
    await new IngestService(prisma as unknown as PrismaService, [source], config()).run(RUN);

    expect(prisma.investor.create).not.toHaveBeenCalled();
    expect(prisma.investor.update.mock.calls[0]![0].where).toEqual({ id: 'i-keep' });
  });
});
