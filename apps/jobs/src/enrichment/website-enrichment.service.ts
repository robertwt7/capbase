import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { canonicalWebsiteTarget, WEBSITE_EXPIRY_MS } from '@repo/api';
import type { Company, CompanyWebsiteScan, Prisma } from '@repo/db';

import { PrismaService } from '../prisma/prisma.service';
import { identifyingDomain } from '../util/domain';
import { discoverAppLinks } from './app-discovery';
import { readEnrichmentConfig } from './enrichment-config';
import { SafeWebsiteFetcher, type WebsiteFetchResult } from './safe-fetch';
import { TECHNOLOGY_CATALOG } from './technology-catalog';
import { DETECTOR_VERSION, detectTechnologies, type TechnologyDetection } from './website-detector';

const DAY = 86_400_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const scanIdentity = (companyId: string, targetUrl: string): string => hash(`${companyId}\n${targetUrl}`);
export interface EnrichmentRunOptions { limit?: number; dryRun?: boolean; slug?: string; signal?: AbortSignal }
export interface EnrichmentCounters {
  eligibleTargets: number; attempted: number; detected: number; noDetections: number;
  blocked: number; retryableFailures: number; staleRecords: number; discarded: number;
  oldestOverdueAt: string | null; deadlineReached: boolean;
}

export function nextAttempt(outcome: string, failures: number, now: Date, refreshDays: number, retryAfterMs = 0, random = Math.random): Date {
  const delay = outcome === 'SUCCESS' || outcome === 'NO_DETECTIONS' ? refreshDays * DAY
    : ['ROBOTS_DENIED', 'UNSUPPORTED', 'INVALID_TARGET'].includes(outcome) ? 30 * DAY
    : ([3_600_000, 6 * 3_600_000, DAY][failures - 1] ?? 7 * DAY);
  return new Date(now.getTime() + Math.max(retryAfterMs, delay * (1 + random() * 0.1)));
}

/** Own-source enrichment has no path through generic ingestion or parent provenance writes. */
@Injectable()
export class WebsiteEnrichmentService {
  private readonly logger = new Logger(WebsiteEnrichmentService.name);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  eligible(company: Pick<Company, 'id' | 'moderationStatus' | 'mergedIntoId' | 'websiteUrl' | 'domain'>, cohort: readonly string[]): string | null {
    if (!cohort.includes(company.id) || company.moderationStatus !== 'APPROVED' || company.mergedIntoId) return null;
    const target = canonicalWebsiteTarget(company.websiteUrl, company.domain);
    return target && identifyingDomain(target) ? target : null;
  }

  /** Lock shared with MergeService, then recheck the exact target and owner. */
  async ensureScan(companyId: string, targetUrl: string, cohort: readonly string[]): Promise<CompanyWebsiteScan | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, companyId);
      const company = await tx.company.findUnique({ where: { id: companyId } });
      if (!company || this.eligible(company, cohort) !== targetUrl) return null;
      const elected = await tx.companyWebsiteScan.findFirst({
        where: { companyId, targetUrl }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (elected) return elected;
      return tx.companyWebsiteScan.upsert({
        where: { scanKey: scanIdentity(companyId, targetUrl) },
        create: { scanKey: scanIdentity(companyId, targetUrl), companyId, targetUrl, targetDomain: new URL(targetUrl).hostname, detectorVersion: DETECTOR_VERSION },
        update: {},
      });
    });
  }

  private async lockOwner(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`;
  }

  /** One bounded discovery page; the cursor survives restarts and cohort changes. */
  private async discover(cohort: string[], slug: string | undefined, dryRun: boolean, signal?: AbortSignal): Promise<Company[]> {
    if (signal?.aborted) return [];
    const key = `website:${hash([...cohort].sort().join(','))}:${slug ?? '*'}`;
    const cursor = await this.prisma.enrichmentCursor.findUnique({ where: { key } });
    const rows = await this.prisma.company.findMany({
      where: { id: { in: cohort, ...(cursor?.cursorId ? { gt: cursor.cursorId } : {}) }, moderationStatus: 'APPROVED', mergedIntoId: null, ...(slug ? { slug } : {}) },
      orderBy: { id: 'asc' }, take: 100,
    });
    if (!dryRun) {
      // Cursor advances only after all scan creations commit. A crash replays idempotently.
      for (const row of rows) {
        // Leave this page's cursor unchanged if interrupted, so the next run
        // replays completed creations safely and still discovers remaining rows.
        if (signal?.aborted) return rows;
        const target = this.eligible(row, cohort);
        if (target) await this.ensureScan(row.id, target, cohort);
      }
      if (signal?.aborted) return rows;
      await this.prisma.enrichmentCursor.upsert({ where: { key }, create: { key, cursorId: rows.length === 100 ? rows[rows.length - 1]!.id : null }, update: { cursorId: rows.length === 100 ? rows[rows.length - 1]!.id : null } });
    }
    return rows;
  }

  /** Election precedes due ordering. Filter obsolete targets before final batch limit. */
  async dueScans(cohort: string[], limit: number, slug?: string, signal?: AbortSignal): Promise<CompanyWebsiteScan[]> {
    return (await this.selectDueScans(cohort, limit, slug, signal)).scans;
  }

  private async selectDueScans(cohort: string[], limit: number, slug?: string, signal?: AbortSignal): Promise<{ scans: CompanyWebsiteScan[]; eligibleTargets: number }> {
    if (!cohort.length || limit < 1 || signal?.aborted) return { scans: [], eligibleTargets: 0 };
    // Only the explicitly configured cohort is paged, never the company corpus.
    // Pair eligibility is resolved before the due scan query; obsolete target
    // rows therefore cannot consume its limit or the whole run's deadline.
    const targets: { companyId: string; targetUrl: string }[] = [];
    let cursorId: string | undefined;
    while (!signal?.aborted) {
      const owners = await this.prisma.company.findMany({
        where: { id: { in: cohort, ...(cursorId ? { gt: cursorId } : {}) }, moderationStatus: 'APPROVED', mergedIntoId: null, ...(slug ? { slug } : {}) },
        orderBy: { id: 'asc' }, take: 100,
        select: { id: true, moderationStatus: true, mergedIntoId: true, websiteUrl: true, domain: true },
      });
      for (const owner of owners) {
        const targetUrl = this.eligible(owner, cohort);
        if (targetUrl) targets.push({ companyId: owner.id, targetUrl });
      }
      if (owners.length < 100) break;
      cursorId = owners[owners.length - 1]!.id;
    }
    if (!targets.length || signal?.aborted) return { scans: [], eligibleTargets: targets.length };
    const scans = await this.prisma.$queryRaw<CompanyWebsiteScan[]>`
        WITH elected AS (
          SELECT DISTINCT ON (s."companyId", s."targetUrl") s.*
          FROM "CompanyWebsiteScan" s JOIN "Company" c ON c.id = s."companyId"
          JOIN UNNEST(${targets.map((target) => target.companyId)}::text[], ${targets.map((target) => target.targetUrl)}::text[])
            AS target("companyId", "targetUrl") ON target."companyId" = s."companyId" AND target."targetUrl" = s."targetUrl"
          WHERE c."moderationStatus" = 'APPROVED'
            AND c."mergedIntoId" IS NULL AND (${slug ?? null}::text IS NULL OR c.slug = ${slug ?? null})
          ORDER BY s."companyId", s."targetUrl", s."createdAt", s.id
        ) SELECT * FROM elected WHERE "nextAttemptAt" <= NOW()
        ORDER BY "nextAttemptAt", id LIMIT ${limit}
      `;
    return { scans, eligibleTargets: targets.length };
  }

  async run(options: EnrichmentRunOptions = {}): Promise<EnrichmentCounters> {
    const cfg = readEnrichmentConfig(this.config, { forCli: true });
    const limit = options.limit ?? cfg.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Technology limit must be 1..100');
    const counters: EnrichmentCounters = { eligibleTargets: 0, attempted: 0, detected: 0, noDetections: 0, blocked: 0, retryableFailures: 0, staleRecords: 0, discarded: 0, oldestOverdueAt: null, deadlineReached: false };
    if (!cfg.companyIds.length) return counters;
    const deadline = AbortSignal.timeout(cfg.timeoutMs);
    const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
    const discovered = await this.discover(cfg.companyIds, options.slug, !!options.dryRun, signal);
    const selection = await this.selectDueScans(cfg.companyIds, limit, options.slug, signal);
    const scans = selection.scans;
    // Dry run may inspect previously undiscovered sites, without persisting scans or cursor.
    const knownScans = options.dryRun ? await this.prisma.companyWebsiteScan.findMany({
      where: { companyId: { in: discovered.map((c) => c.id) } }, select: { companyId: true, targetUrl: true },
    }) : [];
    const pending = options.dryRun ? discovered.flatMap((company) => {
      const target = this.eligible(company, cfg.companyIds);
      return target && !knownScans.some((s) => s.companyId === company.id && s.targetUrl === target) ? [{ companyId: company.id, targetUrl: target }] : [];
    }) : [];
    const work: (CompanyWebsiteScan | { companyId: string; targetUrl: string })[] = [...scans, ...pending].slice(0, limit);
    counters.eligibleTargets = selection.eligibleTargets;
    counters.oldestOverdueAt = scans[0]?.nextAttemptAt.toISOString() ?? null;
    counters.staleRecords = await this.prisma.companyTechnology.count({ where: { scan: { companyId: { in: cfg.companyIds } }, lastSeenAt: { lt: new Date(Date.now() - WEBSITE_EXPIRY_MS) }, retiredAt: null } });
    const fetcher = new SafeWebsiteFetcher({ userAgent: cfg.userAgent });
    for (const scan of work) {
      if (signal.aborted) { counters.deadlineReached = true; break; }
      const owner = await this.prisma.company.findUnique({ where: { id: scan.companyId } });
      if (!owner || this.eligible(owner, cfg.companyIds) !== scan.targetUrl) { counters.discarded++; continue; }
      const result = await fetcher.fetch(scan.targetUrl, signal);
      counters.attempted++;
      const findings = result.outcome === 'SUCCESS' ? detectTechnologies(result.html, result.headers, result.finalUrl) : [];
      if (result.outcome === 'SUCCESS') { if (findings.length) counters.detected += findings.length; else counters.noDetections++; }
      else if (result.outcome === 'RETRYABLE_ERROR') counters.retryableFailures++;
      else counters.blocked++;
      if (!options.dryRun && 'id' in scan) {
        if (!await this.persistResult(scan, owner.updatedAt, cfg.companyIds, result, findings, cfg.refreshDays)) counters.discarded++;
      }
    }
    counters.deadlineReached = signal.aborted;
    this.logger.log(JSON.stringify({ technology: counters, dryRun: !!options.dryRun }));
    return counters;
  }

  /** All changes and retry state are one commit; a failed commit is safe to replay. */
  async persistResult(scan: CompanyWebsiteScan, ownerUpdatedAt: Date, cohort: string[], result: WebsiteFetchResult, findings: TechnologyDetection[], refreshDays = 30, now = new Date()): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, scan.companyId);
      const owner = await tx.company.findUnique({ where: { id: scan.companyId } });
      if (!owner || this.eligible(owner, cohort) !== scan.targetUrl || owner.updatedAt.getTime() !== ownerUpdatedAt.getTime()) return false;
      const elected = await tx.companyWebsiteScan.findFirst({ where: { companyId: scan.companyId, targetUrl: scan.targetUrl }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      if (!elected || elected.id !== scan.id) return false;
      const success = result.outcome === 'SUCCESS';
      const outcome = success ? (findings.length ? 'SUCCESS' : 'NO_DETECTIONS') : result.outcome;
      const failureCount = success ? 0 : elected.failureCount + 1;
      if (success) {
        const evidenceUrl = cleanEvidenceUrl(result.finalUrl);
        const source = await tx.source.upsert({ where: { url: evidenceUrl }, create: { url: evidenceUrl, sourceType: 'Company website', title: 'Company website', retrievedAt: now }, update: { retrievedAt: now } });
        const seen = new Set<string>();
        for (const finding of findings) {
          const catalog = TECHNOLOGY_CATALOG.find((t) => t.slug === finding.slug);
          if (!catalog || seen.has(finding.slug)) continue;
          seen.add(finding.slug);
          const technology = await tx.technology.upsert({ where: { slug: catalog.slug }, create: catalog, update: catalog });
          const old = await tx.companyTechnology.findUnique({ where: { scanId_technologyId: { scanId: scan.id, technologyId: technology.id } } });
          const data = { evidenceUrl, ruleId: finding.ruleId, evidence: finding.evidence.slice(0, 240), lastSeenAt: now, detectorVersion: DETECTOR_VERSION, absenceCount: 0, firstAbsentAt: null, lastAbsentAt: null, retiredAt: null };
          const observation = await tx.companyTechnology.upsert({ where: { scanId_technologyId: { scanId: scan.id, technologyId: technology.id } }, create: { ...data, scanId: scan.id, technologyId: technology.id, firstSeenAt: now }, update: data });
          await tx.citation.upsert({ where: { sourceId_entityType_entityId_field: { sourceId: source.id, entityType: 'companyTechnology', entityId: observation.id, field: '' } }, create: { sourceId: source.id, entityType: 'companyTechnology', entityId: observation.id, note: finding.evidence.slice(0, 240) }, update: { note: finding.evidence.slice(0, 240) } });
          if (!old || old.retiredAt) await this.revision(tx, scan.companyId, 'companyTechnology', observation.id, old ? 'UPDATE' : 'CREATE', { technology: catalog.name, state: 'last observed' });
        }
        const absent = await tx.companyTechnology.findMany({ where: { scanId: scan.id, retiredAt: null, detectorVersion: DETECTOR_VERSION, technology: { slug: { notIn: [...seen] } } } });
        for (const observation of absent) {
          // At most one comparable absence per seven days; rules from a different version never retire a row.
          if (observation.lastAbsentAt && now.getTime() - observation.lastAbsentAt.getTime() < 7 * DAY) continue;
          const count = observation.absenceCount + 1;
          await tx.companyTechnology.update({ where: { id: observation.id }, data: { absenceCount: count, firstAbsentAt: observation.firstAbsentAt ?? now, lastAbsentAt: now, ...(count >= 2 ? { retiredAt: now } : {}) } });
          if (count >= 2) await this.revision(tx, scan.companyId, 'companyTechnology', observation.id, 'UPDATE', { state: 'retired' });
        }
        for (const app of discoverAppLinks(result.html, result.finalUrl)) {
          const resource = await tx.appResource.upsert({ where: { store_appId: { store: app.store, appId: app.appId } }, create: app, update: {} });
          // A merge can leave duplicates: update only the elected existing identity, never generate from the survivor.
          const existing = await tx.companyApp.findFirst({ where: { companyId: scan.companyId, targetUrl: scan.targetUrl, resourceId: resource.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
          if (existing) await tx.companyApp.update({ where: { id: existing.id }, data: { lastSeenAt: now, evidenceUrl } });
          else await tx.companyApp.upsert({ where: { provenanceKey: scanIdentity(scan.companyId, `${scan.targetUrl}\n${app.store}:${app.appId}`) }, create: { provenanceKey: scanIdentity(scan.companyId, `${scan.targetUrl}\n${app.store}:${app.appId}`), companyId: scan.companyId, resourceId: resource.id, targetUrl: scan.targetUrl, evidenceUrl, firstSeenAt: now, lastSeenAt: now }, update: {} });
        }
      }
      const digest = success ? hash(JSON.stringify(findings.map(({ slug, ruleId }) => ({ slug, ruleId })).sort((a, b) => a.slug.localeCompare(b.slug)))) : elected.lastResultDigest;
      await tx.companyWebsiteScan.update({ where: { id: scan.id }, data: { detectorVersion: DETECTOR_VERSION, lastAttemptAt: now, ...(success ? { lastSuccessfulAt: now } : {}), nextAttemptAt: nextAttempt(outcome, failureCount, now, refreshDays, result.retryAfterMs), outcome, failureCount, lastResultDigest: digest } });
      return true;
    });
  }

  private async revision(tx: Prisma.TransactionClient, companyId: string, entityType: string, entityId: string, action: string, after: Prisma.InputJsonValue): Promise<void> {
    await tx.revision.create({ data: { companyId, entityType, entityId, action, actor: 'INGEST', actorSource: 'WEBSITE_TECH', after } });
  }

  /** Suppression is group-wide and remains authoritative across fresh scans and merge duplicates. */
  async suppress(scanId: string, technologySlug: string, reason: string, suppress = true): Promise<void> {
    if (!reason.trim() || reason.length > 500) throw new Error('A reason of 1..500 characters is required');
    const initial = await this.prisma.companyWebsiteScan.findUniqueOrThrow({ where: { id: scanId } });
    await this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, initial.companyId);
      const scan = await tx.companyWebsiteScan.findUniqueOrThrow({ where: { id: scanId } });
      if (scan.companyId !== initial.companyId) throw new Error('Scan ownership changed; retry');
      const observations = await tx.companyTechnology.findMany({ where: { scan: { companyId: scan.companyId, targetUrl: scan.targetUrl }, technology: { slug: technologySlug } } });
      if (!observations.length) throw new Error('No matching observation');
      await tx.companyTechnology.updateMany({ where: { id: { in: observations.map((o) => o.id) } }, data: { suppressedAt: suppress ? new Date() : null, suppressionReason: suppress ? reason.trim() : null } });
      await this.revision(tx, scan.companyId, 'companyTechnology', observations[0]!.id, 'UPDATE', { state: suppress ? 'suppressed' : 'unsuppressed', reason: reason.trim() });
    });
  }

  /** Explicit evidence-backed app approval, or authoritative group-wide suppression. */
  async reviewApp(linkId: string, action: 'verify' | 'suppress' | 'unsuppress', reason: string, evidenceUrl?: string): Promise<void> {
    if (!reason.trim() || reason.length > 500) throw new Error('A reason of 1..500 characters is required');
    if (action === 'verify' && (!evidenceUrl || !/^https?:\/\//.test(evidenceUrl))) throw new Error('Verification requires an evidence URL');
    const initial = await this.prisma.companyApp.findUniqueOrThrow({ where: { id: linkId } });
    await this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, initial.companyId);
      const link = await tx.companyApp.findUniqueOrThrow({ where: { id: linkId } });
      const company = await tx.company.findUniqueOrThrow({ where: { id: initial.companyId } });
      if (link.companyId !== initial.companyId || company.mergedIntoId || canonicalWebsiteTarget(company.websiteUrl, company.domain) !== link.targetUrl) throw new Error('Link ownership or website changed');
      const where = { companyId: link.companyId, targetUrl: link.targetUrl, resourceId: link.resourceId };
      if (action === 'verify') {
        const url = cleanEvidenceUrl(evidenceUrl!);
        await tx.companyApp.updateMany({ where, data: { verifiedAt: new Date(), verificationReason: reason.trim(), verificationUrl: url } });
        const source = await tx.source.upsert({ where: { url }, create: { url, sourceType: 'Company website', title: 'App association evidence', retrievedAt: new Date() }, update: {} });
        const links = await tx.companyApp.findMany({ where, select: { id: true } });
        for (const row of links) await tx.citation.upsert({
          where: { sourceId_entityType_entityId_field: { sourceId: source.id, entityType: 'companyApp', entityId: row.id, field: '' } },
          create: { sourceId: source.id, entityType: 'companyApp', entityId: row.id, note: 'Operator verified website-to-app association' }, update: {},
        });
      } else await tx.companyApp.updateMany({ where, data: { suppressedAt: action === 'suppress' ? new Date() : null, suppressionReason: action === 'suppress' ? reason.trim() : null } });
      await this.revision(tx, link.companyId, 'companyApp', link.id, 'UPDATE', { state: action, reason: reason.trim() });
    });
  }
}

export function cleanEvidenceUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Invalid evidence URL');
  url.search = ''; url.hash = '';
  return url.href;
}
