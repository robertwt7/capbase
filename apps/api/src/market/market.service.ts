import { Injectable, NotFoundException } from '@nestjs/common';
import {
  SITEMAP_PAGE_SIZE,
  VERTICAL_PAGE_MIN_COMPANIES,
  VERTICAL_SECTOR,
  isVertical,
  labelSlug,
  verticalFromSlug,
  type MarketSitemapEntry,
  type MarketStat,
  type MarketTotals,
  type Role,
  type VerticalMarketResponse,
  type VerticalStat,
} from '@repo/api';

import { CompaniesService } from '../companies/companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshingValue } from './refreshing-value';

interface VerticalRow {
  vertical: string;
  companyCount: number;
  publicCompanyCount: number;
  updatedAt: Date;
}

/** Every market aggregate is a full scan of the approved companies (seconds at 340k rows) that
 *  only moves when an ingest, a backfill or an approval runs; recompute at most this often (the
 *  country facet's TTL). */
const MARKET_STATS_TTL_MS = 15 * 60_000;

interface VerticalStats {
  stats: VerticalStat[];
  /** Newest member update per vertical, for sitemap `lastmod`. */
  updatedAt: Map<string, string>;
}

interface SectorCompanyRow {
  sector: string;
  companyCount: number;
  totalRaisedUsd: number;
  medianValuationUsd: number;
}

interface SectorRoundRow {
  sector: string;
  dealCount: number;
  recentDeals: number;
  priorDeals: number;
}

interface TotalsRow {
  totalRaisedUsd: number;
  dealCount: number;
  companyCount: number;
  investorCount: number;
  fundCount: number;
  personCount: number;
}

/** Trailing-90-days vs the 90 days before; 0 when the prior window is empty. */
const trendPct = (recent: number, prior: number): number =>
  prior === 0 ? 0 : Math.round(((recent - prior) / prior) * 1000) / 10;

/** Current calendar quarter label, e.g. "Q3 2026". */
const currentQuarter = (now = new Date()): string =>
  `Q${Math.floor(now.getUTCMonth() / 3) + 1} ${now.getUTCFullYear()}`;

/** A vertical page is indexable when enough of its members are public record. */
const indexableVertical = (s: VerticalStat): boolean => s.publicCompanyCount >= VERTICAL_PAGE_MIN_COMPANIES;

/**
 * Market aggregates computed from approved Company/FundingRound rows — there is no seeded stats
 * table. Each is held in memory for `MARKET_STATS_TTL_MS` and refreshed in the background
 * (`RefreshingValue`), so a page view never waits on the scan: run per request, these scans
 * held the connection pool for seconds each and starved every other read.
 */
@Injectable()
export class MarketService {
  private readonly verticals = new RefreshingValue('Vertical stats', MARKET_STATS_TTL_MS, () =>
    this.queryVerticalStats(),
  );
  private readonly sectors = new RefreshingValue('Sector stats', MARKET_STATS_TTL_MS, () =>
    this.queryStats(),
  );
  private readonly totals = new RefreshingValue('Market totals', MARKET_STATS_TTL_MS, () =>
    this.queryTotals(),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
  ) {}

  /** Every vertical with at least one approved member, largest first. Public and
   *  unconfigurable, like every count (`publicCompanyCount` is provenance-based and never reads
   *  the gate policy, so indexability never depends on the policy). */
  async verticalStats(): Promise<VerticalStat[]> {
    return (await this.verticals.get()).stats;
  }

  /** Test-only: drop the in-process market caches. */
  resetCache(): void {
    this.verticals.reset();
    this.sectors.reset();
    this.totals.reset();
  }

  /** `GET /market/verticals/:slug`. 404 for an unknown slug or a vertical below
   *  `VERTICAL_PAGE_MIN_COMPANIES` members. */
  async verticalMarket(slug: string, viewer?: { id: string; role: Role }): Promise<VerticalMarketResponse> {
    const vertical = verticalFromSlug(slug);
    const stat = vertical ? (await this.verticalStats()).find((s) => s.vertical === vertical) : undefined;
    if (!vertical || !stat || stat.companyCount < VERTICAL_PAGE_MIN_COMPANIES) {
      throw new NotFoundException(`Vertical "${slug}" not found`);
    }
    return this.companies.verticalMarket(vertical, stat, viewer);
  }

  /** One `SITEMAP_PAGE_SIZE` page of indexable vertical pages (84 at most, so one page). */
  async sitemap(page = 0): Promise<MarketSitemapEntry[]> {
    const { stats, updatedAt } = await this.verticals.get();
    return stats
      .filter(indexableVertical)
      .map((s) => ({ slug: `${s.sectorSlug}/${s.slug}`, updatedAt: updatedAt.get(s.vertical)! }))
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .slice(page * SITEMAP_PAGE_SIZE, (page + 1) * SITEMAP_PAGE_SIZE);
  }

  async sitemapCount(): Promise<number> {
    return (await this.verticalStats()).filter(indexableVertical).length;
  }

  private async queryVerticalStats(): Promise<VerticalStats> {
    const rows = await this.prisma.$queryRaw<VerticalRow[]>`
      SELECT v AS vertical,
             COUNT(*)::int AS "companyCount",
             COUNT(*) FILTER (WHERE NOT c."partnerOnly"
                              AND NOT ('verticals' = ANY(c."partnerFields")))::int AS "publicCompanyCount",
             MAX(c."updatedAt") AS "updatedAt"
        FROM "Company" c, unnest(c."verticals") v
       WHERE c."moderationStatus" = 'APPROVED' AND c."mergedIntoId" IS NULL
       GROUP BY v
    `;
    const known = rows.filter((r) => isVertical(r.vertical));
    const stats: VerticalStat[] = known
      .map((r) => {
        const vertical = r.vertical as keyof typeof VERTICAL_SECTOR;
        const sector = VERTICAL_SECTOR[vertical];
        return {
          vertical,
          slug: labelSlug(vertical),
          sector,
          sectorSlug: labelSlug(sector),
          companyCount: r.companyCount,
          publicCompanyCount: r.publicCompanyCount,
        };
      })
      .sort((a, b) => b.companyCount - a.companyCount || a.vertical.localeCompare(b.vertical));
    return { stats, updatedAt: new Map(known.map((r) => [r.vertical, r.updatedAt.toISOString()])) };
  }

  getStats(): Promise<MarketStat[]> {
    return this.sectors.get();
  }

  async getTotals(): Promise<MarketTotals> {
    return { ...(await this.totals.get()), quarter: currentQuarter() };
  }

  private async queryStats(): Promise<MarketStat[]> {
    const [companyRows, roundRows] = await Promise.all([
      this.prisma.$queryRaw<SectorCompanyRow[]>`
        SELECT
          c."primarySector"                                    AS sector,
          COUNT(*)::int                                        AS "companyCount",
          COALESCE(SUM(c."totalRaisedUsd"), 0)::float8         AS "totalRaisedUsd",
          COALESCE(
            percentile_cont(0.5) WITHIN GROUP (ORDER BY c."lastValuationUsd"),
            0
          )::float8                                            AS "medianValuationUsd"
        FROM "Company" c
        WHERE c."moderationStatus" = 'APPROVED' AND c."mergedIntoId" IS NULL
          AND c."primarySector" IS NOT NULL
        GROUP BY c."primarySector"
      `,
      this.prisma.$queryRaw<SectorRoundRow[]>`
        SELECT
          c."primarySector" AS sector,
          COUNT(*)::int     AS "dealCount",
          COUNT(*) FILTER (WHERE r.date >= NOW() - INTERVAL '90 days')::int
                            AS "recentDeals",
          COUNT(*) FILTER (
            WHERE r.date >= NOW() - INTERVAL '180 days'
              AND r.date <  NOW() - INTERVAL '90 days'
          )::int            AS "priorDeals"
        FROM "FundingRound" r
        JOIN "Company" c ON c.id = r."companyId"
        WHERE r."moderationStatus" = 'APPROVED'
          AND c."moderationStatus" = 'APPROVED'
          AND c."mergedIntoId" IS NULL
          AND c."primarySector" IS NOT NULL
          -- Non-dilutive government awards are capital events, not deals.
          AND r."kind" <> 'Grant'
        GROUP BY c."primarySector"
      `,
    ]);

    const rounds = new Map(roundRows.map((r) => [r.sector, r]));
    return companyRows
      .map((c) => {
        const r = rounds.get(c.sector);
        return {
          sector: c.sector,
          companyCount: c.companyCount,
          dealCount: r?.dealCount ?? 0,
          totalRaisedUsd: c.totalRaisedUsd,
          medianValuationUsd: c.medianValuationUsd,
          trendPct: trendPct(r?.recentDeals ?? 0, r?.priorDeals ?? 0),
        };
      })
      .sort((a, b) => b.totalRaisedUsd - a.totalRaisedUsd);
  }

  private async queryTotals(): Promise<Omit<MarketTotals, 'quarter'>> {
    const [row] = await this.prisma.$queryRaw<TotalsRow[]>`
      SELECT
        COALESCE((
          SELECT SUM("totalRaisedUsd") FROM "Company"
          WHERE "moderationStatus" = 'APPROVED' AND "mergedIntoId" IS NULL
        ), 0)::float8 AS "totalRaisedUsd",
        (
          SELECT COUNT(*) FROM "FundingRound" r
          JOIN "Company" c ON c.id = r."companyId"
          WHERE r."moderationStatus" = 'APPROVED' AND c."moderationStatus" = 'APPROVED'
            AND c."mergedIntoId" IS NULL
            -- Non-dilutive government awards are capital events, not deals.
            AND r."kind" <> 'Grant'
        )::int AS "dealCount",
        (
          SELECT COUNT(*) FROM "Company"
          WHERE "moderationStatus" = 'APPROVED' AND "mergedIntoId" IS NULL
        )::int AS "companyCount",
        (
          SELECT COUNT(*) FROM "Investor"
          WHERE "moderationStatus" = 'APPROVED' AND "mergedIntoId" IS NULL
        )::int AS "investorCount",
        (
          SELECT COUNT(*) FROM "Fund" WHERE "moderationStatus" = 'APPROVED'
        )::int AS "fundCount",
        (
          SELECT COUNT(*) FROM "Person"
          WHERE "mergedIntoId" IS NULL AND "suppressedAt" IS NULL
        )::int AS "personCount"
    `;
    return {
      totalRaisedUsd: row?.totalRaisedUsd ?? 0,
      dealCount: row?.dealCount ?? 0,
      companyCount: row?.companyCount ?? 0,
      investorCount: row?.investorCount ?? 0,
      fundCount: row?.fundCount ?? 0,
      personCount: row?.personCount ?? 0,
    };
  }
}
