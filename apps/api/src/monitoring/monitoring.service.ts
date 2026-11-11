import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type SavedSearch } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { FullAccessService, type FullAccess } from '../saved-searches/full-access.guard';
import { SavedSearchesService } from '../saved-searches/saved-searches.service';
import { CompaniesService } from '../companies/companies.service';
import { GatePolicyService } from '../gate/gate-policy.service';
import { MAX_MERGE_HOPS } from '../prisma/public-filters';
const PAGE_SIZE = 2000;
/** Pages a turn-on request baselines inline (10k matches); a broader search stays
 *  `baselining` and the next scheduled run finishes it (seen rows are idempotent). */
const INLINE_BASELINE_PAGES = 5;
/** Owners per set-based funding statement. */
const USER_BATCH = 200;
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly fullAccess: FullAccessService,
    private readonly searches: SavedSearchesService,
    private readonly companies: CompaniesService,
    private readonly policy: GatePolicyService,
  ) {}
  async setSearch(
    userId: string,
    id: string,
    enabled: boolean,
    now = new Date(),
    known?: FullAccess,
  ) {
    await this.fullAccess.require(userId, now, known);
    const source = await this.prisma.savedSearch.findFirst({
      where: { id, userId },
    });
    if (!source) throw new NotFoundException('Search not found');
    if (enabled) await this.searches.decode(source);
    if (!enabled) {
      // Seen rows go, events stay: an event is unique per (search, company) for the search's
      // lifetime, so a company that matched before the user turned monitoring off and on again
      // never produces a second "new match" (the earlier event is hidden as pre-dating it).
      await this.prisma.$transaction([
        this.prisma.savedSearch.updateMany({
          where: { id, userId },
          data: { monitoredAt: null, monitorStatus: null },
        }),
        this.prisma.monitorSeenCompany.deleteMany({ where: { searchId: id } }),
      ]);
      return { enabled: false, status: null };
    }
    // Repeating enable does not reset an active source.
    await this.prisma.savedSearch.updateMany({
      where: { id, userId, monitoredAt: null },
      data: { monitoredAt: now, monitorStatus: 'baselining' },
    });
    const fresh = await this.prisma.savedSearch.findFirstOrThrow({
      where: { id, userId },
    });
    if (fresh.monitorStatus !== 'active')
      await this.evaluateSearch(fresh, now, INLINE_BASELINE_PAGES);
    const result = await this.prisma.savedSearch.findFirstOrThrow({
      where: { id, userId },
    });
    return {
      enabled: result.monitoredAt !== null,
      status: result.monitorStatus,
    };
  }
  async setCompany(
    userId: string,
    slug: string,
    enabled: boolean,
    now = new Date(),
    known?: FullAccess,
  ) {
    await this.fullAccess.require(userId, now, known);
    const company = await this.canonicalSlug(slug);
    if (!company) throw new NotFoundException('Saved company not found');
    const save = await this.prisma.savedCompany.findUnique({
      where: { userId_companyId: { userId, companyId: company.id } },
    });
    if (!save) throw new NotFoundException('Saved company not found');
    if (!enabled) {
      await this.prisma.savedCompany.updateMany({
        where: { id: save.id, userId },
        data: { monitoredAt: null, monitorStatus: null },
      });
      return { enabled: false, status: null };
    }
    await this.prisma.savedCompany.updateMany({
      where: { id: save.id, userId, monitoredAt: null },
      data: { monitoredAt: now, monitorStatus: 'baselining' },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "MonitorSeenRound" ("userId","roundId") SELECT s."userId",r.id FROM "SavedCompany" s JOIN "FundingRound" r ON r."companyId"=s."companyId" WHERE s.id=${save.id} AND s."userId"=${userId} AND s."monitoredAt" IS NOT NULL AND s."monitorStatus"='baselining' AND r."moderationStatus"='APPROVED' ON CONFLICT DO NOTHING`;
      await tx.savedCompany.updateMany({
        where: {
          id: save.id,
          userId,
          monitoredAt: { not: null },
          monitorStatus: 'baselining',
        },
        data: { monitorStatus: 'active', evaluatedAt: now },
      });
    });
    return { enabled: true, status: 'active' };
  }
  async runOnce(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const owners = await this.prisma.user.findMany({
        where: {
          OR: [
            { savedSearches: { some: { monitoredAt: { not: null } } } },
            { savedCompanies: { some: { monitoredAt: { not: null } } } },
          ],
        },
        select: { id: true },
      });
      const eligible: string[] = [];
      for (const owner of owners) {
        try {
          await this.fullAccess.require(owner.id, now);
          eligible.push(owner.id);
        } catch (error) {
          if (
            error instanceof Error &&
            ['ForbiddenException', 'UnauthorizedException'].includes(
              error.constructor.name,
            )
          )
            await this.prisma.$transaction([
              this.prisma.savedSearch.updateMany({
                where: { userId: owner.id, monitoredAt: { not: null } },
                data: { monitorStatus: 'baselining' },
              }),
              this.prisma.savedCompany.updateMany({
                where: { userId: owner.id, monitoredAt: { not: null } },
                data: { monitorStatus: 'baselining' },
              }),
            ]);
          else this.logger.warn('Monitoring owner evaluation deferred');
        }
      }
      if (!eligible.length) return;
      let after: string | undefined;
      while (true) {
        const sources: SavedSearch[] = await this.prisma.savedSearch.findMany({
          where: {
            userId: { in: eligible },
            monitoredAt: { not: null },
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 100,
        });
        for (const source of sources)
          try {
            await this.evaluateSearch(source, now);
          } catch {
            this.logger.warn('Monitoring search evaluation deferred');
          }
        if (sources.length < 100) break;
        after = sources[sources.length - 1]!.id;
      }
      await this.evaluateCompanies(eligible, now);
    } finally {
      this.running = false;
    }
  }
  /** Baseline or scan one search. `maxPages` bounds an inline baseline; the status only
   *  becomes `active` after a complete pass. */
  private async evaluateSearch(source: SavedSearch, now: Date, maxPages = Infinity) {
    let query: Awaited<ReturnType<SavedSearchesService['decode']>>;
    try {
      query = await this.searches.decode(source);
    } catch {
      await this.prisma.savedSearch.updateMany({
        where: { id: source.id, monitoredAt: source.monitoredAt },
        data: { monitorStatus: 'unavailable' },
      });
      return;
    }
    const selection = await this.companies.monitorSelection(query, this.policy.current(), now);
    if (!selection.available) {
      await this.prisma.savedSearch.updateMany({
        where: { id: source.id, monitoredAt: source.monitoredAt },
        data: { monitorStatus: 'unavailable' },
      });
      return;
    }
    const baseline = source.monitorStatus !== 'active';
    let after: string | undefined;
    for (let pages = 0; ; pages++) {
      if (pages >= maxPages) return;
      const ids = await this.companies.companyIdsPage(selection.where, after, PAGE_SIZE);
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.savedSearch.findFirst({
          where: {
            id: source.id,
            userId: source.userId,
            monitoredAt: source.monitoredAt,
            monitorStatus: source.monitorStatus,
          },
        });
        if (!current?.monitoredAt) return;
        const seen = await tx.monitorSeenCompany.findMany({
          where: { searchId: source.id, companyId: { in: ids } },
          select: { companyId: true },
        });
        const known = new Set(seen.map((r) => r.companyId));
        if (!baseline)
          await tx.monitorEvent.createMany({
            data: ids
              .filter((id) => !known.has(id))
              .map((companyId) => ({
                userId: source.userId,
                kind: 'match',
                companyId,
                searchId: source.id,
                observedAt: now,
              })),
            skipDuplicates: true,
          });
        await tx.monitorSeenCompany.createMany({
          data: ids
            .filter((id) => !known.has(id))
            .map((companyId) => ({ searchId: source.id, companyId })),
          skipDuplicates: true,
        });
      });
      if (ids.length < PAGE_SIZE) break;
      after = ids[ids.length - 1];
    }
    await this.prisma.savedSearch.updateMany({
      where: {
        id: source.id,
        userId: source.userId,
        monitoredAt: source.monitoredAt,
        monitorStatus: source.monitorStatus,
      },
      data: { monitorStatus: 'active', evaluatedAt: now },
    });
  }
  /**
   * Funding for monitored saved companies, in batches of owners. Each batch is ONE statement:
   * its CTEs share a snapshot, so a round approved mid-run is either both evented and marked
   * seen, or neither (it is picked up next run) — never marked seen without an event. Only
   * unseen rounds are touched, so the statement's cost tracks new rounds, not history.
   * `baselining` saves (just enabled, or reset by lost access) get seen rows and no events.
   */
  private async evaluateCompanies(userIds: string[], now: Date) {
    for (let i = 0; i < userIds.length; i += USER_BATCH) {
      const batch = userIds.slice(i, i + USER_BATCH);
      await this.prisma.$executeRaw`
        WITH saves AS (
          SELECT s.id, s."userId", s."companyId", s."monitorStatus" FROM "SavedCompany" s
          WHERE s."userId" IN (${Prisma.join(batch)}) AND s."monitoredAt" IS NOT NULL
        ), candidate AS (
          SELECT sv."userId", sv."monitorStatus", r.id AS "roundId", r."companyId", r.kind
          FROM saves sv JOIN "FundingRound" r ON r."companyId" = sv."companyId"
          WHERE r."moderationStatus" = 'APPROVED'
            AND NOT EXISTS (SELECT 1 FROM "MonitorSeenRound" m WHERE m."userId" = sv."userId" AND m."roundId" = r.id)
        ), seen AS (
          INSERT INTO "MonitorSeenRound" ("userId", "roundId")
          SELECT "userId", "roundId" FROM candidate ON CONFLICT DO NOTHING
        ), activated AS (
          UPDATE "SavedCompany" SET "monitorStatus" = 'active', "evaluatedAt" = ${now}
          WHERE id IN (SELECT id FROM saves) AND "monitoredAt" IS NOT NULL
        )
        INSERT INTO "MonitorEvent" (id, "userId", kind, "companyId", "roundId", "observedAt")
        SELECT md5(c."userId" || '/' || c."roundId"), c."userId", 'funding', c."companyId", c."roundId", ${now}
        FROM candidate c JOIN "Company" co ON co.id = c."companyId"
        WHERE c."monitorStatus" = 'active' AND c.kind IN ('Equity', 'Debt')
          AND co."moderationStatus" = 'APPROVED' AND co."mergedIntoId" IS NULL
        ON CONFLICT DO NOTHING`;
    }
  }
  async canonicalSlug(slug: string) {
    let row = await this.prisma.company.findUnique({ where: { slug } });
    for (let hop = 0; row?.mergedIntoId && hop < MAX_MERGE_HOPS; hop++)
      row = await this.prisma.company.findUnique({
        where: { id: row.mergedIntoId },
      });
    return row && !row.mergedIntoId && row.moderationStatus === 'APPROVED'
      ? row
      : null;
  }
}
