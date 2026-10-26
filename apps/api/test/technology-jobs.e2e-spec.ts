import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { createPrismaClient, type Company, type PrismaClient } from '@repo/db';

import { MergeService } from '../src/admin/merge/merge.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { WebsiteEnrichmentService, nextAttempt, scanIdentity } from '../../jobs/src/enrichment/website-enrichment.service';
import { SafeWebsiteFetcher, type WebsiteFetchResult } from '../../jobs/src/enrichment/safe-fetch';
import type { PrismaService as JobsPrisma } from '../../jobs/src/prisma/prisma.service';
import { DETECTOR_VERSION, detectTechnologies } from '../../jobs/src/enrichment/website-detector';

const DAY = 86_400_000;
const success = (html = '<html><meta name="generator" content="WordPress 6"></html>'): WebsiteFetchResult => ({ outcome: 'SUCCESS', html, headers: {}, finalUrl: 'https://technology.example/?token=secret#private' });
const findings = detectTechnologies('<meta name="generator" content="WordPress 6">');

/** Real Postgres proves locking, rollback and merge identity; all network is mocked. */
describe('Website enrichment transactions (e2e)', () => {
  let db: PrismaClient;
  let service: WebsiteEnrichmentService;
  let merge: MergeService;
  let adminId: string;
  let companies: Company[] = [];
  const stamp = `tech-job-${Date.now()}`;
  const config = new ConfigService({ TECH_ENRICHMENT_ENABLED: 'false' });
  let sourceIds: string[] = [];
  const cursorKeys: string[] = [];
  const cohort = () => companies.map((c) => c.id);
  const makeCompany = async (suffix: string, extra: Record<string, unknown> = {}) => {
    const row = await db.company.create({ data: { slug: `${stamp}-${suffix}`, name: `Technology ${suffix}`, domain: 'technology.example', websiteUrl: 'https://technology.example/', oneLiner: '', description: '', hq: '', founded: 0, headcount: 0, status: 'Private', stage: 'Seed', industry: [], totalRaisedUsd: 0n, moderationStatus: 'APPROVED', ...extra } });
    companies.push(row); return row;
  };
  beforeAll(async () => {
    db = createPrismaClient(process.env.DATABASE_URL!);
    await db.$connect();
    service = new WebsiteEnrichmentService(db as JobsPrisma, config);
    merge = new MergeService(db as PrismaService);
    adminId = (await db.user.create({ data: { email: `${stamp}@test.invalid`, name: 'Tech Operator', passwordHash: 'unused', role: 'ADMIN' } })).id;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    const ids = cohort();
    const observations = await db.companyTechnology.findMany({ where: { scan: { companyId: { in: ids } } }, select: { id: true } });
    sourceIds = (await db.citation.findMany({ where: { entityId: { in: observations.map((o) => o.id) } }, select: { sourceId: true } })).map((c) => c.sourceId);
    await db.citation.deleteMany({ where: { entityId: { in: observations.map((o) => o.id) } } });
    await db.mergeRecord.deleteMany({ where: { survivorId: { in: ids } } });
    await db.company.deleteMany({ where: { id: { in: ids } } });
    await db.source.deleteMany({ where: { id: { in: sourceIds }, citations: { none: {} } } });
    await db.enrichmentCursor.deleteMany({ where: { key: { in: cursorKeys.splice(0) } } });
    companies = [];
  });
  afterAll(async () => {
    if (adminId) await db.user.delete({ where: { id: adminId } });
    await db.$disconnect();
  });

  it('creates one stable scan and writes observations/citations once without altering partner provenance', async () => {
    const owner = await makeCompany('partner', { partnerOnly: true, partnerFields: ['domain', 'websiteUrl'], externalSource: 'PARTNER', externalId: stamp });
    const scan = (await service.ensureScan(owner.id, owner.websiteUrl!, cohort()))!;
    expect((await service.ensureScan(owner.id, owner.websiteUrl!, cohort()))!.id).toBe(scan.id);
    expect(scan.scanKey).toBe(scanIdentity(owner.id, owner.websiteUrl!));
    await service.persistResult(scan, owner.updatedAt, cohort(), success(), findings);
    await service.persistResult(scan, owner.updatedAt, cohort(), success(), findings);
    expect(await db.companyTechnology.count({ where: { scanId: scan.id } })).toBe(1);
    expect(await db.revision.count({ where: { companyId: owner.id } })).toBe(1);
    const observation = await db.companyTechnology.findFirstOrThrow({ where: { scanId: scan.id } });
    expect(observation.evidenceUrl).toBe('https://technology.example/');
    expect(await db.citation.count({ where: { entityId: observation.id } })).toBe(1);
    const after = await db.company.findUniqueOrThrow({ where: { id: owner.id } });
    for (const field of ['externalSource', 'externalId', 'partnerOnly', 'partnerFields'] as const) expect(after[field]).toEqual(owner[field]);
  });

  it('requires two comparable absences seven days apart and never advances last positive on failure', async () => {
    const owner = await makeCompany('absences');
    const scan = (await service.ensureScan(owner.id, owner.websiteUrl!, cohort()))!;
    const now = new Date();
    await service.persistResult(scan, owner.updatedAt, cohort(), success(), findings, 30, now);
    await service.persistResult(scan, owner.updatedAt, cohort(), { outcome: 'BLOCKED' }, [], 30, new Date(+now + DAY));
    expect((await db.companyTechnology.findFirstOrThrow({ where: { scanId: scan.id } })).lastSeenAt).toEqual(now);
    await service.persistResult(scan, owner.updatedAt, cohort(), success('<html></html>'), [], 30, new Date(+now + 2 * DAY));
    await service.persistResult(scan, owner.updatedAt, cohort(), success('<html></html>'), [], 30, new Date(+now + 3 * DAY));
    expect((await db.companyTechnology.findFirstOrThrow({ where: { scanId: scan.id } })).retiredAt).toBeNull();
    await service.persistResult(scan, owner.updatedAt, cohort(), success('<html></html>'), [], 30, new Date(+now + 9 * DAY));
    expect((await db.companyTechnology.findFirstOrThrow({ where: { scanId: scan.id } })).retiredAt).not.toBeNull();
    await db.companyTechnology.updateMany({ where: { scanId: scan.id }, data: { retiredAt: null, detectorVersion: 'removed-rules', absenceCount: 0 } });
    await service.persistResult(scan, owner.updatedAt, cohort(), success('<html></html>'), [], 30, new Date(+now + 20 * DAY));
    expect((await db.companyTechnology.findFirstOrThrow({ where: { scanId: scan.id } })).absenceCount).toBe(0);
  });

  it('rolls back observations and due state on a failed commit, then safely retries', async () => {
    const owner = await makeCompany('rollback');
    const scan = (await service.ensureScan(owner.id, owner.websiteUrl!, cohort()))!;
    const revision = jest.spyOn(service as unknown as { revision: () => Promise<void> }, 'revision').mockRejectedValueOnce(new Error('crash before commit'));
    await expect(service.persistResult(scan, owner.updatedAt, cohort(), success(), findings)).rejects.toThrow('crash before commit');
    expect(await db.companyTechnology.count({ where: { scanId: scan.id } })).toBe(0);
    expect((await db.companyWebsiteScan.findUniqueOrThrow({ where: { id: scan.id } })).lastAttemptAt).toBeNull();
    revision.mockRestore();
    await service.persistResult(scan, owner.updatedAt, cohort(), success(), findings);
    expect(await db.companyTechnology.count({ where: { scanId: scan.id } })).toBe(1);
  });

  it('discards in-flight results after website edits, approval withdrawal or merges', async () => {
    const owner = await makeCompany('stale-target');
    const survivor = await makeCompany('survivor');
    const scan = (await service.ensureScan(owner.id, owner.websiteUrl!, cohort()))!;
    await db.company.update({ where: { id: owner.id }, data: { websiteUrl: 'https://changed.example/' } });
    expect(await service.persistResult(scan, owner.updatedAt, cohort(), success(), findings)).toBe(false);
    await db.company.update({ where: { id: owner.id }, data: { websiteUrl: owner.websiteUrl, moderationStatus: 'PENDING' } });
    expect(await service.ensureScan(owner.id, owner.websiteUrl!, cohort())).toBeNull();
    await db.company.update({ where: { id: owner.id }, data: { moderationStatus: 'APPROVED' } });
    await merge.merge('company', survivor.id, owner.id, adminId);
    expect(await service.persistResult(scan, owner.updatedAt, cohort(), success(), findings)).toBe(false);
    expect(await db.companyTechnology.count({ where: { scanId: scan.id } })).toBe(0);
  });

  it('round-trips duplicate target observations, app links, citation anchors and suppression through merge', async () => {
    const first = await makeCompany('duplicate-a'); const second = await makeCompany('duplicate-b');
    const scanA = (await service.ensureScan(first.id, first.websiteUrl!, cohort()))!;
    const scanB = (await service.ensureScan(second.id, second.websiteUrl!, cohort()))!;
    const html = '<html><meta name="generator" content="WordPress"><a href="https://apps.apple.com/us/app/id310633997">App</a></html>';
    await service.persistResult(scanA, first.updatedAt, cohort(), success(html), findings);
    await service.persistResult(scanB, second.updatedAt, cohort(), success(html), findings);
    const before = await db.companyTechnology.findMany({ where: { scanId: { in: [scanA.id, scanB.id] } }, orderBy: { id: 'asc' } });
    const links = await db.companyApp.findMany({ where: { companyId: { in: cohort() } } });
    expect(links).toHaveLength(2);
    await service.reviewApp(links[0]!.id, 'verify', 'Reviewed official website and seller', 'https://technology.example/about?token=secret');
    const { mergeRecordId } = await merge.merge('company', first.id, second.id, adminId);
    expect(await db.companyWebsiteScan.count({ where: { companyId: first.id } })).toBe(2);
    const moved = (await db.mergeRecord.findUniqueOrThrow({ where: { id: mergeRecordId } })).moved as { remapped: Record<string, string[]> };
    expect(moved.remapped.companyWebsiteScan).toContain(scanB.id);
    await service.suppress(scanA.id, 'wordpress', 'False signature');
    expect(await db.companyTechnology.count({ where: { scanId: { in: [scanA.id, scanB.id] }, suppressedAt: { not: null } } })).toBe(2);
    await service.persistResult(scanA, first.updatedAt, cohort(), success(), findings);
    expect(await db.companyTechnology.count({ where: { scanId: scanA.id, suppressedAt: { not: null } } })).toBe(1);
    await service.suppress(scanB.id, 'wordpress', 'Reviewed', false);
    expect(await db.companyTechnology.count({ where: { scanId: { in: [scanA.id, scanB.id] }, suppressedAt: { not: null } } })).toBe(0);
    await merge.unmerge(mergeRecordId, adminId);
    expect((await db.companyWebsiteScan.findUniqueOrThrow({ where: { id: scanB.id } })).companyId).toBe(second.id);
    expect((await db.companyWebsiteScan.findUniqueOrThrow({ where: { id: scanB.id } })).scanKey).toBe(scanB.scanKey);
    expect((await db.companyApp.findUniqueOrThrow({ where: { id: links[1]!.id } })).companyId).toBe(links[1]!.companyId);
    expect((await db.companyTechnology.findMany({ where: { id: { in: before.map((o) => o.id) } } })).map((o) => o.id).sort()).toEqual(before.map((o) => o.id).sort());
  });

  it('filters overdue duplicates and obsolete targets before the batch limit', async () => {
    const owner = await makeCompany('due');
    const elected = (await service.ensureScan(owner.id, owner.websiteUrl!, cohort()))!;
    await db.companyWebsiteScan.update({ where: { id: elected.id }, data: { nextAttemptAt: new Date(Date.now() - DAY) } });
    await db.companyWebsiteScan.createMany({ data: Array.from({ length: 110 }, (_, n) => ({ scanKey: `${stamp}-${n}`, companyId: owner.id, targetUrl: `https://old-${n}.example/`, targetDomain: `old-${n}.example`, detectorVersion: DETECTOR_VERSION, nextAttemptAt: new Date(0) })) });
    await db.companyWebsiteScan.create({ data: { scanKey: `${stamp}-duplicate`, companyId: owner.id, targetUrl: owner.websiteUrl!, targetDomain: owner.domain, detectorVersion: DETECTOR_VERSION, createdAt: new Date(Date.now() + 1), nextAttemptAt: new Date(0) } });
    expect((await service.dueScans(cohort(), 1)).map((s) => s.id)).toEqual([elected.id]);
  });

  it('enforces cohort and slug in manual runs and dry-run writes no domain data', async () => {
    const owner = await makeCompany('dry'); await makeCompany('outside');
    config.set('TECH_ENRICHMENT_COMPANY_IDS', owner.id);
    jest.spyOn(SafeWebsiteFetcher.prototype, 'fetch').mockResolvedValue(success());
    const counts = await service.run({ dryRun: true, limit: 10 });
    expect(counts.attempted).toBe(1);
    expect(await db.companyWebsiteScan.count({ where: { companyId: { in: cohort() } } })).toBe(0);
    expect(await db.enrichmentCursor.count()).toBe(0);
    cursorKeys.push(`website:${createHash('sha256').update(owner.id).digest('hex')}:${companies[1]!.slug}`);
    expect((await service.run({ slug: companies[1]!.slug })).attempted).toBe(0);
    config.set('TECH_ENRICHMENT_COMPANY_IDS', '');
    expect((await service.run()).attempted).toBe(0);
  });

  it('scan creation waits for a merge child capture and rechecks the tombstone afterward', async () => {
    const survivor = await makeCompany('lock-keep'); const loser = await makeCompany('lock-lose');
    let captured!: () => void; const capture = new Promise<void>((resolve) => { captured = resolve; });
    let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    // The real merge transaction owns both company row locks before capturing children.
    const wrapped = { $executeRaw: db.$executeRaw.bind(db) } as PrismaClient;
    wrapped.$transaction = (async (fn: (tx: unknown) => Promise<unknown>) => db.$transaction(async (tx) => {
      const original = tx.companyWebsiteScan.findMany.bind(tx.companyWebsiteScan);
      tx.companyWebsiteScan.findMany = (async (...args: Parameters<typeof original>) => { captured(); await held; return original(...args); }) as typeof original;
      return fn(tx);
    })) as typeof db.$transaction;
    const merging = new MergeService(wrapped as PrismaService).merge('company', survivor.id, loser.id, adminId);
    await capture;
    const creation = service.ensureScan(loser.id, loser.websiteUrl!, cohort());
    release();
    await merging;
    expect(await creation).toBeNull();
    expect(await db.companyWebsiteScan.count({ where: { companyId: loser.id } })).toBe(0);
  });

  it('classifies retry cadence and honors longer Retry-After values', () => {
    const now = new Date(0);
    expect(+nextAttempt('RETRYABLE_ERROR', 1, now, 30, 0, () => 0)).toBe(3_600_000);
    expect(+nextAttempt('RETRYABLE_ERROR', 2, now, 30, 0, () => 0)).toBe(6 * 3_600_000);
    expect(+nextAttempt('RETRYABLE_ERROR', 3, now, 30, 0, () => 0)).toBe(DAY);
    expect(+nextAttempt('RETRYABLE_ERROR', 4, now, 30, 0, () => 0)).toBe(7 * DAY);
    expect(+nextAttempt('ROBOTS_DENIED', 1, now, 30, 40 * DAY, () => 0)).toBe(40 * DAY);
  });
});
