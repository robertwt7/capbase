import { ConfigService } from '@nestjs/config';
import type { Company, CompanyWebsiteScan } from '@repo/db';

import type { PrismaService } from '../prisma/prisma.service';
import { SafeWebsiteFetcher } from './safe-fetch';
import { WebsiteEnrichmentService } from './website-enrichment.service';

function company(id: string, overrides: Partial<Company> = {}): Company {
  return { id, moderationStatus: 'APPROVED', mergedIntoId: null, websiteUrl: `https://${id}.example/`, domain: `${id}.example`, ...overrides } as Company;
}

function harness(cohort: string[]) {
  const prisma = {
    company: { findMany: jest.fn(), findUnique: jest.fn() },
    enrichmentCursor: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    companyTechnology: { count: jest.fn().mockResolvedValue(0) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const config = new ConfigService({ TECH_ENRICHMENT_COMPANY_IDS: cohort.join(',') });
  return { prisma, service: new WebsiteEnrichmentService(prisma as unknown as PrismaService, config) };
}

describe('bounded current-target selection', () => {
  it('selects only eligible exact target pairs before due ordering and limiting', async () => {
    const eligible = company('eligible', { websiteUrl: 'https://www.current.example/path?tracking=private' });
    const invalid = company('invalid', { websiteUrl: 'https://www.linkedin.com/company/invalid' });
    const outsideCohort = company('outside');
    const rejected = company('rejected', { moderationStatus: 'REJECTED' });
    const merged = company('merged', { mergedIntoId: 'survivor' });
    const rows = [eligible, invalid, outsideCohort, rejected, merged];
    const made = harness(rows.filter((row) => row.id !== 'outside').map((row) => row.id));
    made.prisma.company.findMany.mockResolvedValue(rows);
    const scan = { id: 'current', companyId: 'eligible', targetUrl: 'https://www.current.example/' };
    made.prisma.$queryRaw.mockResolvedValue([scan]);
    expect(await made.service.dueScans(['eligible', 'invalid', 'rejected', 'merged'], 1)).toEqual([scan]);
    const [sql, companyIds, targets] = made.prisma.$queryRaw.mock.calls[0]!;
    expect(companyIds).toEqual(['eligible']);
    expect(targets).toEqual(['https://www.current.example/']);
    // The real database integration verifies starvation. This boundary test
    // ensures obsolete URLs cannot even enter the SQL candidate set.
    expect(sql.join('?')).toContain('JOIN UNNEST(');
    expect(made.prisma.company.findMany.mock.calls[0]?.[0]).toMatchObject({ take: 100 });
  });

  it('pages only the explicit cohort without loading the whole company corpus', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => company(`company-${String(index).padStart(3, '0')}`));
    const cohort = rows.map((row) => row.id);
    const made = harness(cohort);
    made.prisma.company.findMany.mockResolvedValueOnce(rows.slice(0, 100)).mockResolvedValueOnce(rows.slice(100));
    await made.service.dueScans(cohort, 5, 'chosen-slug');
    expect(made.prisma.company.findMany).toHaveBeenCalledTimes(2);
    expect(made.prisma.company.findMany.mock.calls[1]?.[0]).toMatchObject({
      where: { id: { in: cohort, gt: 'company-099' }, slug: 'chosen-slug' }, take: 100,
    });
    expect(made.prisma.$queryRaw.mock.calls[0]?.[1]).toHaveLength(101);
  });

  it('performs no target or scan query for an empty cohort or already expired deadline', async () => {
    const made = harness([]);
    expect(await made.service.dueScans([], 5)).toEqual([]);
    expect(await made.service.dueScans(['eligible'], 5, undefined, AbortSignal.abort())).toEqual([]);
    expect(made.prisma.company.findMany).not.toHaveBeenCalled();
    expect(made.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('stops target enumeration at the deadline before querying any due scans', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => company(`company-${index}`));
    const cohort = rows.map((row) => row.id);
    const made = harness(cohort);
    const controller = new AbortController();
    made.prisma.company.findMany.mockImplementation(async () => { controller.abort(); return rows; });
    expect(await made.service.dueScans(cohort, 5, undefined, controller.signal)).toEqual([]);
    expect(made.prisma.company.findMany).toHaveBeenCalledTimes(1);
    expect(made.prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('discovery interruption and restart', () => {
  it('counts the full eligible cohort even when none of its targets are due', async () => {
    const rows = [company('first'), company('second'), company('platform', { websiteUrl: 'https://linkedin.com/company/platform' })];
    const made = harness(rows.map((row) => row.id));
    made.prisma.company.findMany.mockResolvedValue(rows);
    jest.spyOn(made.service, 'ensureScan').mockResolvedValue(null);
    const result = await made.service.run();
    expect(result).toMatchObject({ eligibleTargets: 2, attempted: 0, deadlineReached: false });
    expect(made.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('leaves an interrupted page cursor unchanged and creates no later scans', async () => {
    const rows = [company('first'), company('second')];
    const made = harness(rows.map((row) => row.id));
    const controller = new AbortController();
    made.prisma.company.findMany.mockResolvedValue(rows);
    const ensure = jest.spyOn(made.service, 'ensureScan').mockImplementation(async () => {
      controller.abort();
      return { id: 'first-scan' } as CompanyWebsiteScan;
    });
    const fetch = jest.spyOn(SafeWebsiteFetcher.prototype, 'fetch');
    try {
      const result = await made.service.run({ signal: controller.signal });
      expect(ensure).toHaveBeenCalledTimes(1);
      expect(made.prisma.enrichmentCursor.upsert).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({ attempted: 0, deadlineReached: true });
    } finally { fetch.mockRestore(); }
  });

  it('does not acknowledge a discovery page when a scan creation fails', async () => {
    const rows = [company('first'), company('second')];
    const made = harness(rows.map((row) => row.id));
    made.prisma.company.findMany.mockResolvedValue(rows);
    jest.spyOn(made.service, 'ensureScan').mockResolvedValueOnce({ id: 'first-scan' } as CompanyWebsiteScan)
      .mockRejectedValueOnce(new Error('transaction crashed'));
    await expect(made.service.run()).rejects.toThrow('transaction crashed');
    expect(made.prisma.enrichmentCursor.upsert).not.toHaveBeenCalled();
  });
});
