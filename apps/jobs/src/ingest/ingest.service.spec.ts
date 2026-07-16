import { describe, it, expect, jest } from '@jest/globals';

import { IngestService, normalizeName } from './ingest.service';
import { PrismaService } from '../prisma/prisma.service';
import type { IngestionSource, NormalizedRecord } from '../sources/ingestion-source';

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
    ...overrides,
  };
}

function mockPrisma(existing: ReturnType<typeof companyRow>[] = []) {
  return {
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
    fundingRound: { upsert: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({})) },
    person: { upsert: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({})) },
    investorHolding: { upsert: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({})) },
    acquisitionDeal: { upsert: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({})) },
    exitEvent: { upsert: jest.fn<(args: unknown) => Promise<unknown>>(async () => ({})) },
  };
}

function stubSource(records: NormalizedRecord[]): IngestionSource {
  return { name: 'STUB', fetch: async () => records };
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

function serviceWith(prisma: ReturnType<typeof mockPrisma>, records: NormalizedRecord[]) {
  return new IngestService(prisma as unknown as PrismaService, [stubSource(records)]);
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

  it('skips the round upsert when the record has no round', async () => {
    const prisma = mockPrisma();
    await serviceWith(prisma, [record()]).run(RUN);
    expect(prisma.fundingRound.upsert).not.toHaveBeenCalled();
  });

  it('upserts the round keyed by (source, round.externalId)', async () => {
    const prisma = mockPrisma();
    const r = record({
      round: { externalId: 'acc-1', name: 'Private placement (Form D)', date: '2026-06-15', amountUsd: 7_500_000 },
    });
    await serviceWith(prisma, [r]).run(RUN);

    expect(prisma.fundingRound.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalSource_externalId: { externalSource: 'STUB', externalId: 'acc-1' } },
        create: expect.objectContaining({
          companyId: 'c-new',
          moderationStatus: 'APPROVED',
          amountUsd: 7_500_000n,
        }),
      }),
    );
  });

  it('upserts people, investors, acquisitions and exits with provenance keys', async () => {
    const prisma = mockPrisma();
    const r = record({
      people: [{ externalId: 'X1:person:jane', name: 'Jane Founder', role: 'Executive Officer', since: 2026, title: 'CEO' }],
      investors: [{ externalId: 'X1:investor:q9', name: 'Big Fund', type: 'Venture', firstRound: 'Undisclosed', rounds: 1 }],
      acquisitions: [{ externalId: 'X1:acq:q8', target: 'Small Co', date: '2024-01-02', amountUsd: null, rationale: 'Tuck-in.' }],
      exits: [{ externalId: 'X1:exit:ipo', type: 'IPO', date: '2025-05-05', valueUsd: 1_000_000_000, detail: 'Initial public offering.' }],
    });
    await serviceWith(prisma, [r]).run(RUN);

    expect(prisma.person.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalSource_externalId: { externalSource: 'STUB', externalId: 'X1:person:jane' } },
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
        create: expect.objectContaining({ name: 'Big Fund', type: 'Venture', moderationStatus: 'APPROVED' }),
      }),
    );
    expect(prisma.acquisitionDeal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ target: 'Small Co', amountUsd: null, moderationStatus: 'APPROVED' }),
      }),
    );
    expect(prisma.exitEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ type: 'IPO', valueUsd: 1_000_000_000n, moderationStatus: 'APPROVED' }),
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
        data: expect.objectContaining({ name: 'Acme Robotics, Inc.', stage: 'Series A' }),
      }),
    );
  });

  it('filters sources by name when opts.sources is provided', async () => {
    const prisma = mockPrisma();
    const service = new IngestService(prisma as unknown as PrismaService, [stubSource([record()])]);
    const result = await service.run({ ...RUN, sources: ['OTHER'] });
    expect(result).toEqual({ processed: 0, upserted: 0 });
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
      people: [{ externalId: 'Q42:person:q7:CEO', name: 'Jane Founder', role: 'CEO', since: 2019 }],
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
        where: { externalSource_externalId: { externalSource: 'WIKIDATA', externalId: 'Q42:person:q7:CEO' } },
        create: expect.objectContaining({ companyId: 'c-sec' }),
      }),
    );
  });

  it('keeps human-written copy: only SEC placeholder text is replaced', async () => {
    const prisma = mockPrisma([
      companyRow({ oneLiner: 'Hand-written pitch.', description: 'Curated description.' }),
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

    const { data } = prisma.company.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.domain).toBe('acme.com');
    expect(data).not.toHaveProperty('oneLiner');
    expect(data).not.toHaveProperty('description');
  });

  it('matches by domain even when names differ', async () => {
    const prisma = mockPrisma([companyRow({ domain: 'acme.com', name: 'Totally Different Name' })]);
    const r = record({
      source: 'WIKIDATA',
      companyExternalId: 'Q42',
      company: { ...record().company, name: 'Acme Robotics', domain: 'acme.com' },
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
      company: { ...record().company, name: 'Acme Robotics', domain: 'acme.com', headcount: 900 },
    });
    await serviceWith(prisma, [r]).run(RUN);
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('appends the external id to the slug on collision', async () => {
    const prisma = mockPrisma([
      companyRow({ id: 'c-other', slug: 'acme', name: 'Acme Capital Partners', domain: 'other.com' }),
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
