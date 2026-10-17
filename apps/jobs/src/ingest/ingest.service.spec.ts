import { describe, it, expect, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';

import { IngestService, normalizeFundName, normalizeInvestorName, normalizeName } from './ingest.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  IngestionSource,
  NormalizedFund,
  NormalizedInvestorFirm,
  NormalizedRecord,
  SourceBatch,
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

/** A Person row as loadPersonIndex reads it back. */
function personRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    slug: 'jane-founder',
    name: 'Jane Founder',
    normalizedName: 'jane founder',
    mergedIntoId: null,
    suppressedAt: null,
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
  existingPeople: ReturnType<typeof personRow>[] = [],
  existingRounds: Record<string, unknown>[] = [],
) {
  let created = 0;
  let fundsCreated = 0;
  let peopleCreated = 0;
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
      upsert: jest.fn<(args: unknown) => Promise<unknown>>(async (args) => ({
        id: `r-${(args as { where: { externalSource_externalId: { externalId: string } } }).where.externalSource_externalId.externalId}`,
      })),
      findMany: jest.fn<(args: unknown) => Promise<unknown[]>>(async () => existingRounds),
      update: jest.fn<(args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>>(
        async (args) => ({ id: args.where.id }),
      ),
      aggregate: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({ _sum: { amountUsd: null } })),
    },
    roundInvestor: {
      deleteMany: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({ count: 0 })),
      createMany: jest.fn<(args: { data: Record<string, unknown>[] }) => Promise<unknown>>(async () => ({})),
    },
    fundCommitment: {
      upsert: jest.fn<(args: Record<string, unknown>) => Promise<unknown>>(async () => ({})),
    },
    fundMetric: {
      upsert: jest.fn<(args: Record<string, unknown>) => Promise<unknown>>(async () => ({})),
    },
    personRole: {
      upsert: jest.fn<(args: unknown) => Promise<unknown>>(async (args) => ({
        id: `role-${(args as { where: { externalSource_externalId: { externalId: string } } }).where.externalSource_externalId.externalId}`,
      })),
    },
    personContact: {
      upsert: jest.fn<(args: Record<string, unknown>) => Promise<unknown>>(async () => ({})),
    },
    $executeRaw: jest.fn<(...args: unknown[]) => Promise<number>>(async () => 0),
    person: {
      findMany: jest.fn<(args: unknown) => Promise<unknown[]>>(async () => existingPeople),
      create: jest.fn<(args: { data: Record<string, unknown> }) => Promise<{ id: string }>>(
        async () => ({ id: `p-new-${++peopleCreated}` }),
      ),
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

    expect(prisma.personRole.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          externalSource_externalId: {
            externalSource: 'STUB',
            externalId: 'X1:person:jane',
          },
        },
        create: expect.objectContaining({
          companyId: 'c-new',
          // Resolved to a Person, which is the invariant the nullable column
          // relies on: every write path populates it.
          personId: 'p-new-1',
          name: 'Jane Founder',
          role: 'Executive Officer',
          title: 'CEO',
          moderationStatus: 'APPROVED',
        }),
        update: {
          personId: 'p-new-1',
          role: 'Executive Officer',
          kind: null,
          title: 'CEO',
          endYear: null,
        },
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
    expect(prisma.personRole.upsert).toHaveBeenCalledWith(
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

describe('IngestService person resolution', () => {
  function person(overrides: Record<string, unknown> = {}) {
    return {
      externalId: 'X1:person:jane',
      name: 'Jane Founder',
      role: 'Executive Officer',
      since: 2024,
      ...overrides,
    };
  }

  /** The personId the role row was written with, whatever the outcome. */
  function writtenPersonId(prisma: ReturnType<typeof mockPrisma>): unknown {
    const call = prisma.personRole.upsert.mock.calls[0]![0] as {
      create: { personId: unknown };
    };
    return call.create.personId;
  }

  it('creates a person with a unique slug when nothing matches', async () => {
    const prisma = mockPrisma();
    await serviceWith(prisma, [record({ people: [person()] })]).run(RUN);

    expect(prisma.person.create).toHaveBeenCalledTimes(1);
    expect(prisma.person.create.mock.calls[0]![0].data).toMatchObject({
      slug: 'jane-founder',
      name: 'Jane Founder',
      normalizedName: 'jane founder',
      moderationStatus: 'APPROVED',
    });
    expect(writtenPersonId(prisma)).toBe('p-new-1');
  });

  it('attaches to an existing person by exact normalized name', async () => {
    const prisma = mockPrisma([], [], [], [], [personRow({ id: 'p-known' })]);
    await serviceWith(prisma, [record({ people: [person({ name: 'JANE  FOUNDER' })] })]).run(RUN);

    expect(prisma.person.create).not.toHaveBeenCalled();
    expect(writtenPersonId(prisma)).toBe('p-known');
  });

  it('prefers the identifier over the name, and follows a merge tombstone', async () => {
    // The loser keeps its QID, so the crosswalk entry still points at it; the
    // index resolves the tombstone, which is what stops the next cron run from
    // undoing the merge.
    const prisma = mockPrisma(
      [],
      [],
      [],
      [{ scheme: 'WIKIDATA', value: 'Q30', entityType: 'person', entityId: 'p-lost', source: 'X' }],
      [
        personRow({ id: 'p-lost', slug: 'pc-old', normalizedName: 'old spelling', mergedIntoId: 'p-live' }),
        personRow({ id: 'p-live', slug: 'patrick-collison', normalizedName: 'patrick collison' }),
      ],
    );
    await serviceWith(prisma, [
      record({
        people: [
          person({
            name: 'Someone Else Entirely',
            identifiers: [{ scheme: 'WIKIDATA', value: 'Q30' }],
          }),
        ],
      }),
    ]).run(RUN);

    expect(prisma.person.create).not.toHaveBeenCalled();
    expect(writtenPersonId(prisma)).toBe('p-live');
  });

  it('neither matches nor recreates a suppressed person', async () => {
    // Ingest auto-APPROVES on every run, so a removal request only survives if
    // the match index refuses both the name and the QID.
    const prisma = mockPrisma(
      [],
      [],
      [],
      [{ scheme: 'WIKIDATA', value: 'Q30', entityType: 'person', entityId: 'p-gone', source: 'X' }],
      [personRow({ id: 'p-gone', suppressedAt: new Date('2026-01-01') })],
    );
    await serviceWith(prisma, [
      record({ people: [person({ identifiers: [{ scheme: 'WIKIDATA', value: 'Q30' }] })] }),
    ]).run(RUN);

    expect(prisma.person.create).not.toHaveBeenCalled();
    expect(writtenPersonId(prisma)).toBeNull();
  });

  it('records a candidate when a QID is claimed by a different person', async () => {
    const prisma = mockPrisma(
      [],
      [],
      [],
      [{ scheme: 'WIKIDATA', value: 'Q30', entityType: 'person', entityId: 'p-1', source: 'X' }],
      // p-1 exists but under a different name, so the incoming row creates a
      // second person and the QID write collides.
      [personRow({ id: 'p-1', normalizedName: 'someone else' })],
    );
    await serviceWith(prisma, [
      record({
        people: [
          person({ name: 'Jane Founder', identifiers: [{ scheme: 'WIKIDATA', value: 'Q31' }] }),
          person({
            externalId: 'X1:person:jane2',
            name: 'Jane Other',
            identifiers: [{ scheme: 'WIKIDATA', value: 'Q30' }],
          }),
        ],
      }),
    ]).run(RUN);

    // The second person matched p-1 by QID rather than being created…
    expect(prisma.person.create).toHaveBeenCalledTimes(1);
    // …and the first minted a fresh identifier without disturbing p-1's.
    expect(prisma.identifiers).toContainEqual(
      expect.objectContaining({ scheme: 'WIKIDATA', value: 'Q31', entityType: 'person' }),
    );
  });

  it('leaves a role unattached when the name normalizes to nothing', async () => {
    const prisma = mockPrisma();
    await serviceWith(prisma, [record({ people: [person({ name: '  ' })] })]).run(RUN);

    expect(prisma.person.create).not.toHaveBeenCalled();
    expect(writtenPersonId(prisma)).toBeNull();
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

  it('writes a firm officer as a role on the firm, with no company', async () => {
    const prisma = mockPrisma();
    await serviceWithFirms(prisma, [
      firm({
        people: [
          {
            externalId: 'Q20:person:Q40:Founder',
            name: 'Don Valentine',
            role: 'Founder',
            kind: 'Founder',
            since: 1972,
            identifiers: [{ scheme: 'WIKIDATA', value: 'Q40' }],
          },
        ],
      }),
    ]).run(RUN);

    expect(prisma.personRole.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.personRole.upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>;
    };
    expect(call.create).toMatchObject({
      investorId: 'i-new-1',
      personId: 'p-new-1',
      name: 'Don Valentine',
      kind: 'Founder',
      moderationStatus: 'APPROVED',
    });
    // A role hangs off a company OR a firm, never both.
    expect(call.create.companyId).toBeUndefined();
  });

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
    ['Société Générale', 'societe generale'],
    ['Zürich Insurance Group AG', 'zurich insurance group'],
    ['Acme Widgets LLP', 'acme widgets'],
    ['Acme Widgets GmbH', 'acme widgets'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it('folds accents for investor names too', () => {
    expect(normalizeInvestorName('Société Générale Capital')).toBe('societe generale capital');
  });
});

describe('IngestService country-scoped name matching', () => {
  function uk(company: Partial<NormalizedRecord['company']> = {}): NormalizedRecord {
    return record({
      source: 'COMPANIES_HOUSE',
      companyExternalId: '05002194',
      company: {
        name: 'Acme Ltd',
        hq: 'London, United Kingdom',
        foundedYear: 2004,
        industry: [],
        stage: 'Late stage',
        totalRaisedUsd: 0,
        countryCode: 'GB',
        websiteUrl: 'https://acme.example.co.uk',
        ...company,
      },
    });
  }

  it('creates a new row rather than enriching a same-name row in another country', async () => {
    const prisma = mockPrisma([companyRow({ id: 'c-us', name: 'Acme Inc', countryCode: 'US' })]);
    await serviceWith(prisma, [uk()]).run(RUN);

    expect(prisma.company.update).not.toHaveBeenCalled();
    expect(prisma.company.create).toHaveBeenCalledTimes(1);
    expect(prisma.company.create.mock.calls[0]![0].data).toMatchObject({ countryCode: 'GB' });
  });

  it('enriches a same-name row whose country is unknown, filling the country', async () => {
    const prisma = mockPrisma([companyRow({ id: 'c-any', name: 'Acme', countryCode: null })]);
    await serviceWith(prisma, [uk()]).run(RUN);

    expect(prisma.company.create).not.toHaveBeenCalled();
    const update = prisma.company.update.mock.calls[0]![0] as unknown as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(update.where.id).toBe('c-any');
    expect(update.data).toMatchObject({ countryCode: 'GB' });
  });

  it('skips the foreign holder of a name and enriches the compatible one behind it', async () => {
    const prisma = mockPrisma([
      companyRow({ id: 'c-us', name: 'Acme Inc', countryCode: 'US' }),
      companyRow({ id: 'c-gb', name: 'ACME LIMITED', countryCode: 'GB', externalSource: 'X', externalId: '9' }),
    ]);
    await serviceWith(prisma, [uk()]).run(RUN);

    expect(prisma.company.create).not.toHaveBeenCalled();
    const update = prisma.company.update.mock.calls[0]![0] as unknown as { where: { id: string } };
    expect(update.where.id).toBe('c-gb');
  });

  it('still matches across countries on an identifier', async () => {
    // An identifier is the publisher's statement about the entity; the
    // country rule only constrains the name inference.
    const prisma = mockPrisma(
      [companyRow({ id: 'c-us', name: 'Something Else', countryCode: 'US' })],
      [],
      [],
      [{ scheme: 'COMPANIES_HOUSE', value: '05002194', entityType: 'company', entityId: 'c-us', source: 'X' }],
    );
    await serviceWith(prisma, [uk({ identifiers: [{ scheme: 'COMPANIES_HOUSE', value: '5002194' }] })]).run(RUN);

    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it('writes the record’s country, legal name, status and type on create', async () => {
    const prisma = mockPrisma();
    await serviceWith(prisma, [
      uk({ legalName: 'ACME LTD', operatingStatus: 'Active', companyType: 'For profit' }),
    ]).run(RUN);

    expect(prisma.company.create.mock.calls[0]![0].data).toMatchObject({
      countryCode: 'GB',
      legalName: 'ACME LTD',
      operatingStatus: 'Active',
      companyType: 'For profit',
    });
  });

  it('adds a stated country on its own-key update, and never erases one', async () => {
    const own = companyRow({ id: 'c-own', externalSource: 'STUB', externalId: 'X1', countryCode: 'US' });
    const stated = mockPrisma([own]);
    await serviceWith(stated, [record({ company: { ...record().company, countryCode: 'US' } })]).run(RUN);
    const statedData = (stated.company.update.mock.calls[0]![0] as unknown as { data: Record<string, unknown> }).data;
    expect(statedData.countryCode).toBe('US');

    const silent = mockPrisma([own]);
    await serviceWith(silent, [record()]).run(RUN);
    const silentData = (silent.company.update.mock.calls[0]![0] as unknown as { data: Record<string, unknown> }).data;
    expect(silentData).not.toHaveProperty('countryCode');
  });

  it('never name-matches a row that holds a different Companies House number', async () => {
    // Costain Limited 00610201 and 01393773 are two legal entities; a name
    // match must not fold the second into the first.
    const prisma = mockPrisma(
      [companyRow({ id: 'c-gb', name: 'Acme Limited', countryCode: 'GB' })],
      [],
      [],
      [{ scheme: 'COMPANIES_HOUSE', value: '01393773', entityType: 'company', entityId: 'c-gb', source: 'X' }],
    );
    await serviceWith(prisma, [uk({ identifiers: [{ scheme: 'COMPANIES_HOUSE', value: '05002194' }] })]).run(RUN);

    expect(prisma.company.update).not.toHaveBeenCalled();
    expect(prisma.company.create).toHaveBeenCalledTimes(1);
  });

  it('keeps two same-named records with different numbers apart within one run', async () => {
    const prisma = mockPrisma();
    let n = 0;
    prisma.company.create.mockImplementation(async () => ({ id: `c-new-${++n}` }));
    await serviceWith(prisma, [
      uk({ identifiers: [{ scheme: 'COMPANIES_HOUSE', value: '00610201' }] }),
      uk({ identifiers: [{ scheme: 'COMPANIES_HOUSE', value: '01393773' }] }),
    ].map((r, i) => ({ ...r, companyExternalId: `k${i}` }))).run(RUN);

    expect(prisma.company.create).toHaveBeenCalledTimes(2);
  });

  it('still name-matches a row whose number is the record’s own, or that has none', async () => {
    const prisma = mockPrisma([companyRow({ id: 'c-gb', name: 'Acme Limited', countryCode: 'GB' })]);
    await serviceWith(prisma, [uk({ identifiers: [{ scheme: 'COMPANIES_HOUSE', value: '05002194' }] })]).run(RUN);
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it('passes the Companies House numbers already held to every source', async () => {
    const prisma = mockPrisma(
      [companyRow({ id: 'c-1' })],
      [],
      [],
      [{ scheme: 'COMPANIES_HOUSE', value: '05002194', entityType: 'company', entityId: 'c-1', source: 'X' }],
    );
    let seen: ReadonlySet<string> | undefined;
    const source: IngestionSource = {
      name: 'STUB',
      fetch: async (opts) => {
        seen = opts.knownCompanyNumbers;
        return [];
      },
    };
    await new IngestService(prisma as unknown as PrismaService, [source], config()).run(RUN);

    expect([...(seen ?? [])]).toEqual(['05002194']);
  });
});

describe('IngestService round currency', () => {
  it('stores a non-USD round’s published amount beside its USD equivalent', async () => {
    const prisma = mockPrisma();
    const r = record({
      rounds: [
        {
          externalId: 'p-1:05002194',
          name: 'Innovate UK grant',
          date: '2022-04-01',
          amountUsd: 553_000,
          amountLocal: 425_000,
          currency: 'GBP',
          kind: 'Grant',
        },
      ],
    });
    await serviceWith(prisma, [r]).run(RUN);

    const call = prisma.fundingRound.upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call.create).toMatchObject({ currency: 'GBP', amountLocal: 425_000n, amountUsd: 553_000n });
    expect(call.update).toMatchObject({ currency: 'GBP', amountLocal: 425_000n });
  });

  it('defaults to USD with no local amount', async () => {
    const prisma = mockPrisma();
    const r = record({
      rounds: [{ externalId: 'acc-1', name: 'Form D', date: '2026-06-15', amountUsd: 1_000, amountLocal: 999 }],
    });
    await serviceWith(prisma, [r]).run(RUN);

    const call = prisma.fundingRound.upsert.mock.calls[0]![0] as { create: Record<string, unknown> };
    expect(call.create).toMatchObject({ currency: 'USD', amountLocal: null });
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

describe('IngestService streaming sources (Phase 2 seams)', () => {
  function streamSource(batches: SourceBatch[]): IngestionSource {
    return {
      name: 'PARTNER',
      fetch: async () => {
        throw new Error('a streaming source is never fetched');
      },
      stream: async function* () {
        for (const b of batches) yield b;
      },
    };
  }

  const serviceFor = (prisma: ReturnType<typeof mockPrisma>, batches: SourceBatch[]) =>
    new IngestService(prisma as unknown as PrismaService, [streamSource(batches)], config());

  const pid = (value: string) => ({ scheme: 'PARTNER' as const, value });

  const partnerFirm = (over: Partial<NormalizedInvestorFirm> = {}): NormalizedInvestorFirm => ({
    externalId: '501',
    name: 'Granite Peak Partners',
    type: 'Private equity',
    identifiers: [pid('501')],
    ...over,
  });

  const fundRef = { externalId: 'F1', name: 'Granite Peak Fund II', manager: { externalId: '501', identifier: pid('501') } };

  const partnerFund = (over: Partial<NormalizedFund> = {}): NormalizedFund => ({
    externalId: 'F1',
    name: 'Granite Peak Fund II',
    manager: { externalId: '501', identifier: pid('501') },
    status: 'Closed',
    closedUsd: 400_000_000,
    finalCloseDate: '2019-06-30',
    managementFeePct: 2,
    carriedInterestPct: 20,
    ...over,
  });

  it('applies a batch in dependency order and never calls fetch', async () => {
    const prisma = mockPrisma();
    const order: string[] = [];
    prisma.investor.create.mockImplementation(async () => {
      order.push('investor');
      return { id: 'i-new-1' };
    });
    prisma.fund.create.mockImplementation(async () => {
      order.push('fund');
      return { id: 'f-new-1' };
    });
    prisma.company.create.mockImplementation(async () => {
      order.push('company');
      return { id: 'c-new' };
    });
    prisma.fundCommitment.upsert.mockImplementation(async () => {
      order.push('commitment');
      return {};
    });
    prisma.fundMetric.upsert.mockImplementation(async () => {
      order.push('metric');
      return {};
    });

    const result = await serviceFor(prisma, [
      {
        // Deliberately listed out of order: the service, not the object, fixes it.
        metrics: [{ fund: fundRef, asAt: '2024-06-30', aumUsd: 1 }],
        commitments: [
          { externalId: 'F1:777', fund: fundRef, investor: { externalId: '777', identifier: pid('777') }, amountUsd: 5 },
        ],
        records: [record({ source: 'PARTNER' })],
        funds: [partnerFund()],
        investors: [partnerFirm(), partnerFirm({ externalId: '777', name: 'State Pension Plan', type: 'Pension fund', identifiers: [pid('777')] })],
      },
    ]).run(RUN);

    expect(order).toEqual(['investor', 'investor', 'fund', 'company', 'commitment', 'metric']);
    expect(result).toMatchObject({ investors: 2, funds: 1, upserted: 1 });
  });

  it('resolves a fund manager by the source id, mints a slug and records the terms', async () => {
    const prisma = mockPrisma();
    await serviceFor(prisma, [{ investors: [partnerFirm()], funds: [partnerFund()] }]).run(RUN);

    expect(prisma.fund.create.mock.calls[0]![0].data).toMatchObject({
      managerId: 'i-new-1',
      slug: 'granite-peak-fund-ii',
      status: 'Closed',
      closedUsd: 400_000_000n,
      sizeUsd: 400_000_000n,
      finalCloseDate: new Date('2019-06-30'),
      managementFeePct: 2,
      carriedInterestPct: 20,
      externalSource: 'PARTNER',
      externalId: 'F1',
    });
  });

  it('resolves a manager the source MATCHED earlier through its identifier', async () => {
    // A prior run matched partner firm 501 to an existing ADV row, so the row
    // keeps its own provenance and only the identifier records the link.
    const prisma = mockPrisma(
      [],
      [investorRow({ id: 'i-adv', externalSource: 'SEC_ADV', externalId: '999' })],
      [],
      [{ scheme: 'PARTNER', value: '501', entityType: 'investor', entityId: 'i-adv', source: 'PARTNER' }],
    );
    await serviceFor(prisma, [{ funds: [partnerFund()] }]).run(RUN);
    expect(prisma.fund.create.mock.calls[0]![0].data).toMatchObject({ managerId: 'i-adv' });
  });

  it('skips a fund whose manager is not held, and never by name', async () => {
    const prisma = mockPrisma([], [investorRow({ id: 'i-namesake', name: 'Granite Peak Partners' })]);
    const result = await serviceFor(prisma, [{ funds: [partnerFund()] }]).run(RUN);
    expect(result.funds).toBe(0);
    expect(prisma.fund.create).not.toHaveBeenCalled();
  });

  it('enriches a same-manager fund by name, and edges still find it on a later run', async () => {
    const prisma = mockPrisma(
      [],
      [investorRow({ id: 'i-adv', externalSource: 'SEC_ADV', externalId: '999' })],
      [fundRow({ id: 'f-adv', name: 'Granite Peak Fund II, L.P.', managerId: 'i-adv' })],
      [{ scheme: 'PARTNER', value: '501', entityType: 'investor', entityId: 'i-adv', source: 'PARTNER' }],
    );
    await serviceFor(prisma, [
      {
        funds: [partnerFund()],
        metrics: [{ fund: fundRef, asAt: '2024-06-30', aumUsd: 9 }],
      },
    ]).run(RUN);

    expect(prisma.fund.create).not.toHaveBeenCalled();
    expect(prisma.fund.update.mock.calls[0]![0]).toMatchObject({ where: { id: 'f-adv' } });
    expect(prisma.fundMetric.upsert.mock.calls[0]![0]).toMatchObject({
      where: { fundId_asAt: { fundId: 'f-adv', asAt: new Date('2024-06-30') } },
    });
  });

  it('matches a same-manager fund even when another manager holds a namesake (stable re-runs)', async () => {
    const prisma = mockPrisma(
      [],
      [investorRow({ id: 'i-adv', externalSource: 'SEC_ADV', externalId: '999' }), investorRow({ id: 'i-other' })],
      [
        fundRow({ id: 'f-adv', name: 'Granite Peak Fund II, L.P.', managerId: 'i-adv' }),
        // Another firm's fund with the same normalized name: the global index
        // drops the name, but the manager-scoped one must still resolve.
        fundRow({ id: 'f-namesake', name: 'Granite Peak Fund II', managerId: 'i-other' }),
      ],
      [{ scheme: 'PARTNER', value: '501', entityType: 'investor', entityId: 'i-adv', source: 'PARTNER' }],
    );
    await serviceFor(prisma, [{ funds: [partnerFund()] }]).run(RUN);
    expect(prisma.fund.create).not.toHaveBeenCalled();
    expect(prisma.fund.update.mock.calls[0]![0]).toMatchObject({ where: { id: 'f-adv' } });
  });

  it('upserts a commitment on its provenance key, and skips one with a missing end', async () => {
    const prisma = mockPrisma(
      [],
      [
        investorRow({ id: 'i-lp', externalSource: 'PARTNER', externalId: '777' }),
        investorRow({ id: 'i-gp', externalSource: 'PARTNER', externalId: '501' }),
      ],
      [fundRow({ id: 'f-p', managerId: 'i-gp', externalSource: 'PARTNER', externalId: 'F1' })],
    );
    await serviceFor(prisma, [
      {
        commitments: [
          {
            externalId: 'F1:777',
            fund: fundRef,
            investor: { externalId: '777' },
            currency: 'EUR',
            amountLocal: 20_000_000,
            amountUsd: 22_000_000,
          },
          { externalId: 'F1:888', fund: fundRef, investor: { externalId: '888' } },
          { externalId: 'F9:777', fund: { ...fundRef, externalId: 'F9', name: 'Unknown' }, investor: { externalId: '777' } },
        ],
      },
    ]).run(RUN);

    expect(prisma.fundCommitment.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.fundCommitment.upsert.mock.calls[0]![0]).toMatchObject({
      where: { externalSource_externalId: { externalSource: 'PARTNER', externalId: 'F1:777' } },
      create: {
        fundId: 'f-p',
        investorId: 'i-lp',
        currency: 'EUR',
        amountLocal: 20_000_000n,
        amountUsd: 22_000_000n,
        moderationStatus: 'APPROVED',
      },
    });
  });

  it('replaces only this source’s firms on a round, by firm id, idempotently', async () => {
    const prisma = mockPrisma([], [
      investorRow({ id: 'i-gp', name: 'Granite Peak Partners', externalSource: 'PARTNER', externalId: '501' }),
    ]);
    const r = record({
      source: 'PARTNER',
      rounds: [
        {
          externalId: 'D1',
          name: 'Series A',
          date: '2022-01-10',
          amountUsd: 5_000_000,
          investors: [{ externalId: '501', lead: true }, { externalId: 'gone' }],
        },
      ],
    });
    await serviceFor(prisma, [{ records: [r] }]).run(RUN);
    await serviceFor(prisma, [{ records: [r] }]).run(RUN);

    expect(prisma.roundInvestor.deleteMany.mock.calls[0]![0]).toEqual({
      where: { roundId: 'r-D1', investorId: { in: ['i-gp'] } },
    });
    expect(prisma.roundInvestor.createMany.mock.calls[0]![0]).toEqual({
      data: [{ roundId: 'r-D1', investorId: 'i-gp', name: 'Granite Peak Partners', lead: true }],
    });
    // The re-run issues the same delete-then-create, so nothing accumulates.
    expect(prisma.roundInvestor.createMany.mock.calls[1]![0]).toEqual(
      prisma.roundInvestor.createMany.mock.calls[0]![0],
    );
  });

  describe('identifier-only people and private contacts', () => {
    const contactPerson = (over: Record<string, unknown> = {}) => ({
      externalId: 'C1:501',
      name: 'Jane Founder',
      role: 'Partner',
      title: 'Partner',
      since: 2026,
      identifiers: [pid('C1')],
      identifierOnly: true,
      contact: { email: 'jane@example.test', phone: '+1 555 0100', linkedinUrl: 'https://www.linkedin.com/in/jane' },
      ...over,
    });

    it('marks the people it creates as identifier-only', async () => {
      const prisma = mockPrisma();
      await serviceFor(prisma, [{ investors: [partnerFirm({ people: [contactPerson()] })] }]).run(RUN);
      expect(prisma.person.create.mock.calls[0]![0].data).toMatchObject({ identifierOnly: true });
    });

    it('never name-merges an identifier-only person', async () => {
      const prisma = mockPrisma([], [], [], [], [personRow({ id: 'p-formd' })]);
      await serviceFor(prisma, [{ investors: [partnerFirm({ people: [contactPerson()] })] }]).run(RUN);

      expect(prisma.person.create).toHaveBeenCalledTimes(1);
      const role = prisma.personRole.upsert.mock.calls[0]![0] as unknown as { create: Record<string, unknown> };
      expect(role.create.personId).toBe('p-new-1');
    });

    it('does not let a later name-keyed person attach to an identifier-only one', async () => {
      const prisma = mockPrisma();
      const svc = new IngestService(
        prisma as unknown as PrismaService,
        [
          streamSource([{ investors: [partnerFirm({ people: [contactPerson()] })] }]),
          stubSource([record({ people: [{ externalId: 'x:jane', name: 'Jane Founder', role: 'CEO', since: 2020 }] })]),
        ],
        config(),
      );
      await svc.run(RUN);
      expect(prisma.person.create).toHaveBeenCalledTimes(2);
    });

    it('keeps a partner person out of name matching on a LATER run too', async () => {
      // A previous partner run created p-partner and gave them a PARTNER id.
      const prisma = mockPrisma(
        [],
        [],
        [],
        [{ scheme: 'PARTNER', value: 'C1', entityType: 'person', entityId: 'p-partner', source: 'PARTNER' }],
        [personRow({ id: 'p-partner', identifierOnly: true })],
      );
      // Now a name-keyed source (Form D) names a "Jane Founder".
      await serviceWith(prisma, [record({ people: [{ externalId: 'x:jane', name: 'Jane Founder', role: 'CEO', since: 2020 }] })]).run(RUN);
      expect(prisma.person.create).toHaveBeenCalledTimes(1);
      const role = prisma.personRole.upsert.mock.calls[0]![0] as unknown as { create: Record<string, unknown> };
      expect(role.create.personId).toBe('p-new-1');
    });

    it('matches the same contact at a second firm through the identifier', async () => {
      const prisma = mockPrisma();
      await serviceFor(prisma, [
        {
          investors: [
            partnerFirm({ people: [contactPerson()] }),
            partnerFirm({ externalId: '502', name: 'Other Firm', identifiers: [pid('502')], people: [contactPerson({ externalId: 'C1:502' })] }),
          ],
        },
      ]).run(RUN);
      expect(prisma.person.create).toHaveBeenCalledTimes(1);
      expect(prisma.personRole.upsert).toHaveBeenCalledTimes(2);
    });

    it('stores contact details privately, keyed on the role, never on a public column', async () => {
      const prisma = mockPrisma();
      await serviceFor(prisma, [{ investors: [partnerFirm({ people: [contactPerson()] })] }]).run(RUN);

      const role = prisma.personRole.upsert.mock.calls[0]![0] as unknown as { create: Record<string, unknown> };
      expect(role.create.linkedinUrl).toBeNull();
      expect(JSON.stringify(role)).not.toContain('jane@example.test');
      expect(prisma.personContact.upsert.mock.calls[0]![0]).toEqual({
        where: { externalSource_externalId: { externalSource: 'PARTNER', externalId: 'C1:501' } },
        create: {
          personId: 'p-new-1',
          roleId: 'role-C1:501',
          email: 'jane@example.test',
          phone: '+1 555 0100',
          linkedinUrl: 'https://www.linkedin.com/in/jane',
          externalSource: 'PARTNER',
          externalId: 'C1:501',
        },
        update: {
          personId: 'p-new-1',
          roleId: 'role-C1:501',
          email: 'jane@example.test',
          phone: '+1 555 0100',
          linkedinUrl: 'https://www.linkedin.com/in/jane',
        },
      });
    });

    it('writes no contact for a suppressed person', async () => {
      const prisma = mockPrisma([], [], [], [], [personRow({ id: 'p-gone', suppressedAt: new Date() })]);
      await serviceFor(prisma, [{ investors: [partnerFirm({ people: [contactPerson()] })] }]).run(RUN);
      expect(prisma.person.create).not.toHaveBeenCalled();
      expect(prisma.personContact.upsert).not.toHaveBeenCalled();
    });
  });

  describe('cross-source round dedup', () => {
    const formD = (over: Record<string, unknown> = {}) => ({
      id: 'r-formd',
      name: 'Private placement (Form D)',
      date: new Date('2022-02-01T00:00:00Z'),
      amountUsd: 0n,
      kind: 'Equity',
      currency: 'USD',
      amountLocal: null,
      externalSource: 'SEC_EDGAR',
      externalId: '0001-22-000001',
      ...over,
    });
    const partnerRecord = (over: Partial<NormalizedRecord> = {}) =>
      record({
        source: 'PARTNER',
        companyExternalId: 'PC1',
        roundDedup: 'enrich',
        company: { ...record().company, name: 'Acme Robotics, Inc.', domain: 'acme.example' },
        rounds: [
          {
            externalId: 'D1',
            name: 'Series A',
            date: '2022-01-10',
            amountUsd: 8_000_000,
            investors: [{ externalId: '501' }],
          },
        ],
        ...over,
      });

    it('folds a near-duplicate into the existing ingested round and corrects it', async () => {
      const prisma = mockPrisma(
        [companyRow({ domain: 'acme.example' })],
        [investorRow({ id: 'i-gp', externalSource: 'PARTNER', externalId: '501' })],
        [],
        [],
        [],
        [formD()],
      );
      await serviceFor(prisma, [{ records: [partnerRecord()] }]).run(RUN);

      expect(prisma.fundingRound.upsert).not.toHaveBeenCalled();
      expect(prisma.fundingRound.update.mock.calls[0]![0]).toEqual({
        where: { id: 'r-formd' },
        data: {
          name: 'Series A',
          date: new Date('2022-01-10'),
          amountUsd: 8_000_000n,
          currency: 'USD',
          amountLocal: null,
        },
      });
      const revs = revisionsFrom(prisma).filter((r) => r.entityType === 'round');
      expect(revs.map((r) => r.field).sort()).toEqual(['amountUsd', 'date', 'name']);
      expect(revs.every((r) => r.actorSource === 'PARTNER' && r.entityId === 'r-formd')).toBe(true);
      // The partner's investors land on the rung that exists.
      expect(prisma.roundInvestor.createMany.mock.calls[0]![0]).toMatchObject({
        data: [{ roundId: 'r-formd', investorId: 'i-gp' }],
      });
    });

    it('does not treat its own record id as strong evidence on a re-run', async () => {
      // A first run matched this Form D company by NAME and attached the
      // partner's record id to it; the re-run hits that id.
      const prisma = mockPrisma(
        [companyRow()],
        [],
        [],
        [{ scheme: 'PARTNER', value: 'PC1', entityType: 'company', entityId: 'c-sec', source: 'PARTNER' }],
        [],
        [formD()],
      );
      const r = partnerRecord();
      r.company = { ...r.company, domain: undefined, identifiers: [{ scheme: 'PARTNER', value: 'PC1' }] };
      await serviceFor(prisma, [{ records: [r] }]).run(RUN);
      expect(prisma.fundingRound.upsert).not.toHaveBeenCalled();
      expect(prisma.fundingRound.update).not.toHaveBeenCalled();
    });

    it('never lowers its own company total on a re-run', async () => {
      // An own-key row whose total another partner record raised earlier.
      const prisma = mockPrisma(
        [companyRow({ id: 'c-own', externalSource: 'PARTNER', externalId: 'PC1', totalRaisedUsd: 90_000_000n })],
      );
      prisma.fundingRound.aggregate.mockResolvedValue({ _sum: { amountUsd: 8_000_000n } });
      await serviceFor(prisma, [{ records: [partnerRecord()] }]).run(RUN);
      const updates = prisma.company.update.mock.calls.map((c) => c[0] as unknown as { data: Record<string, unknown> });
      expect(updates.some((u) => 'totalRaisedUsd' in u.data)).toBe(false);
    });

    it('never rewrites a round on a company matched by name alone — it only skips the duplicate', async () => {
      const prisma = mockPrisma([companyRow()], [], [], [], [], [formD()]);
      // companyRow has no domain and no identifier: this record matches by name.
      await serviceFor(prisma, [{ records: [partnerRecord()] }]).run(RUN);
      expect(prisma.fundingRound.upsert).not.toHaveBeenCalled();
      expect(prisma.fundingRound.update).not.toHaveBeenCalled();
    });

    it('keeps a known amount on the existing round', async () => {
      const prisma = mockPrisma([companyRow({ domain: 'acme.example' })], [], [], [], [], [formD({ amountUsd: 7_000_000n })]);
      await serviceFor(prisma, [{ records: [partnerRecord()] }]).run(RUN);
      const data = prisma.fundingRound.update.mock.calls[0]![0].data;
      expect(data).not.toHaveProperty('amountUsd');
    });

    it('never modifies a human contribution, but still does not duplicate it', async () => {
      const prisma = mockPrisma([companyRow()], [], [], [], [], [formD({ externalSource: null, externalId: null })]);
      await serviceFor(prisma, [{ records: [partnerRecord()] }]).run(RUN);
      expect(prisma.fundingRound.upsert).not.toHaveBeenCalled();
      expect(prisma.fundingRound.update).not.toHaveBeenCalled();
    });

    it('updates its own round in place on a re-run instead of re-pairing it', async () => {
      const prisma = mockPrisma(
        [companyRow()],
        [],
        [],
        [],
        [],
        [formD(), formD({ id: 'r-own', name: 'Seed', externalSource: 'PARTNER', externalId: 'D1' })],
      );
      await serviceFor(prisma, [{ records: [partnerRecord()] }]).run(RUN);
      expect(prisma.fundingRound.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.fundingRound.update).not.toHaveBeenCalled();
    });

    it('does nothing of the sort without roundDedup — every round is written', async () => {
      const prisma = mockPrisma([companyRow()], [], [], [], [], [formD()]);
      await serviceFor(prisma, [{ records: [partnerRecord({ roundDedup: undefined })] }]).run(RUN);
      expect(prisma.fundingRound.findMany).not.toHaveBeenCalled();
      expect(prisma.fundingRound.upsert).toHaveBeenCalledTimes(1);
    });

    it('raises a stale company total to the sum of its rounds, never lowers it', async () => {
      const prisma = mockPrisma([companyRow({ domain: 'acme.example', totalRaisedUsd: 1_000_000n })], [], [], [], [], [formD()]);
      prisma.fundingRound.aggregate.mockResolvedValue({ _sum: { amountUsd: 8_000_000n } });
      await serviceFor(prisma, [{ records: [partnerRecord()] }]).run(RUN);
      const updates = prisma.company.update.mock.calls.map((c) => c[0] as unknown as { data: Record<string, unknown> });
      expect(updates.some((u) => u.data.totalRaisedUsd === 8_000_000n)).toBe(true);

      const lower = mockPrisma([companyRow({ domain: 'acme.example', totalRaisedUsd: 90_000_000n })], [], [], [], [], [formD()]);
      lower.fundingRound.aggregate.mockResolvedValue({ _sum: { amountUsd: 8_000_000n } });
      await serviceFor(lower, [{ records: [partnerRecord()] }]).run(RUN);
      const lowered = lower.company.update.mock.calls.map((c) => c[0] as unknown as { data: Record<string, unknown> });
      expect(lowered.some((u) => 'totalRaisedUsd' in u.data)).toBe(false);
    });
  });
});
