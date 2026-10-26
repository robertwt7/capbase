import { describe, expect, it, jest } from '@jest/globals';
import type { ViewerAccess } from '@repo/api';

import type { PrismaService } from '../prisma/prisma.service';
import { loadCompanyTechnology } from './company-technology.reader';

const now = new Date('2026-10-26T00:00:00Z');
const recent = new Date('2026-10-20T00:00:00Z');
const company = { id: 'c1', websiteUrl: 'https://acme.example/about', domain: 'acme.example' };
const locked: ViewerAccess = { unlocked: false, signedIn: false, unlockedUntil: null };
const unlocked: ViewerAccess = { unlocked: true, signedIn: true, unlockedUntil: null };

function harness() {
  const scans = [
    { id: 'old', companyId: 'c1', targetUrl: 'https://acme.example/', createdAt: new Date('2026-01-01') },
    { id: 'duplicate', companyId: 'c1', targetUrl: 'https://acme.example/', createdAt: new Date('2026-02-01') },
  ];
  const observations = ['alpha', 'beta', 'gamma'].map((id) => ({
    id, scanId: 'old', technologyId: id, suppressedAt: null as Date | null,
    retiredAt: null as Date | null, lastSeenAt: recent, firstSeenAt: new Date('2026-09-01'),
    evidenceUrl: 'https://acme.example/', evidence: 'Explicit generator',
    technology: { slug: id, name: id, category: 'CMS', vendorUrl: 'https://vendor.example/' },
  }));
  const findScan = jest.fn(async (args: { where: { companyId: string; targetUrl: string } }) =>
    scans.filter((s) => s.companyId === args.where.companyId && s.targetUrl === args.where.targetUrl)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0] ?? null,
  );
  type Query = {
    where: { scan?: { companyId: string; targetUrl: string }; scanId?: string; suppressedAt?: unknown;
      lastSeenAt?: { gt: Date }; technologyId?: { notIn: string[] } };
    take?: number;
  };
  const eligible = (query: Query) => observations.filter((o) =>
    o.scanId === query.where.scanId && !o.retiredAt && o.lastSeenAt > query.where.lastSeenAt!.gt &&
    !query.where.technologyId!.notIn.includes(o.technologyId),
  );
  const findObservations = jest.fn(async (query: Query) => {
    if (query.where.scan) {
      const ids = scans.filter((s) => s.companyId === query.where.scan!.companyId && s.targetUrl === query.where.scan!.targetUrl).map((s) => s.id);
      return observations.filter((o) => ids.includes(o.scanId) && o.suppressedAt !== null);
    }
    return eligible(query).slice(0, query.take);
  });
  const count = jest.fn(async (query: Query) => eligible(query).length);
  const queryRaw = jest.fn(async () => []);
  const prisma = {
    companyWebsiteScan: { findFirst: findScan },
    companyTechnology: { findMany: findObservations, count },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  return { prisma, scans, observations, findScan, findObservations, count, queryRaw };
}

describe('company technology detail projection', () => {
  it('previews two rows and returns current totals and individual observation dates', async () => {
    const h = harness();
    const result = await loadCompanyTechnology(h.prisma, company, locked, now);
    expect(result.companyTechnologies.map((t) => t.id)).toEqual(['alpha', 'beta']);
    expect(result.totals).toEqual({ companyTechnologies: 3, companyApps: 0 });
    expect(result.companyTechnologies[0]).toMatchObject({ lastSeenAt: recent.toISOString(), evidence: 'Explicit generator' });
    expect(JSON.stringify(result)).not.toContain('detectorVersion');
    expect(h.findScan).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }));
  });

  it('returns every eligible row when unlocked', async () => {
    const h = harness();
    expect((await loadCompanyTechnology(h.prisma, company, unlocked, now)).companyTechnologies).toHaveLength(3);
  });

  it('expires elected observations at read time even when a newer duplicate is fresh', async () => {
    const h = harness();
    h.observations[0]!.lastSeenAt = new Date('2026-01-01');
    h.observations.push({ ...h.observations[0]!, id: 'fresh-duplicate', scanId: 'duplicate', lastSeenAt: recent });
    const result = await loadCompanyTechnology(h.prisma, company, unlocked, now);
    expect(result.companyTechnologies.map((t) => t.id)).toEqual(['beta', 'gamma']);
    expect(result.totals.companyTechnologies).toBe(2);
  });

  it('group-wide suppression hides the elected observation without borrowing duplicate freshness', async () => {
    const h = harness();
    h.observations.push({ ...h.observations[0]!, id: 'suppressed-duplicate', scanId: 'duplicate', suppressedAt: recent });
    const result = await loadCompanyTechnology(h.prisma, company, unlocked, now);
    expect(result.companyTechnologies.map((t) => t.id)).toEqual(['beta', 'gamma']);
    h.observations[3]!.suppressedAt = null;
    expect((await loadCompanyTechnology(h.prisma, company, unlocked, now)).companyTechnologies.map((t) => t.id))
      .toEqual(['alpha', 'beta', 'gamma']);
  });

  it('retired elected observations stay hidden despite a live duplicate', async () => {
    const h = harness();
    h.observations[0]!.retiredAt = recent;
    h.observations.push({ ...h.observations[0]!, id: 'unretired-duplicate', scanId: 'duplicate', retiredAt: null });
    expect((await loadCompanyTechnology(h.prisma, company, unlocked, now)).companyTechnologies.map((t) => t.id))
      .toEqual(['beta', 'gamma']);
  });

  it('excludes the previous target immediately after a website change', async () => {
    const h = harness();
    const result = await loadCompanyTechnology(h.prisma, { ...company, websiteUrl: 'https://new.example/' }, unlocked, now);
    expect(result.companyTechnologies).toEqual([]);
    expect(h.findObservations).not.toHaveBeenCalled();
  });

  it('returns empty data without any query for invalid targets', async () => {
    const h = harness();
    const result = await loadCompanyTechnology(h.prisma, { ...company, websiteUrl: 'file:///etc/passwd' }, unlocked, now);
    expect(result.totals).toEqual({ companyTechnologies: 0, companyApps: 0 });
    expect(h.findScan).not.toHaveBeenCalled();
    expect(h.queryRaw).not.toHaveBeenCalled();
  });
});
