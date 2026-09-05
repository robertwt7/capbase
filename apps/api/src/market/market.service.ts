import { Injectable } from '@nestjs/common';
import type { MarketStat, MarketTotals } from '@repo/api';

import { PrismaService } from '../prisma/prisma.service';

/** Valuation threshold for the "unicorn" count on the landing hero. */
const UNICORN_USD = 1_000_000_000;

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
  unicorns: number;
}

/** Trailing-90-days vs the 90 days before; 0 when the prior window is empty. */
const trendPct = (recent: number, prior: number): number =>
  prior === 0 ? 0 : Math.round(((recent - prior) / prior) * 1000) / 10;

/** Current calendar quarter label, e.g. "Q3 2026". */
const currentQuarter = (now = new Date()): string =>
  `Q${Math.floor(now.getUTCMonth() / 3) + 1} ${now.getUTCFullYear()}`;

/**
 * Market aggregates computed live from approved Company/FundingRound rows —
 * there is no seeded stats table. Cheap at current scale (two grouped scans);
 * the web's 60s ISR window caches the result.
 */
@Injectable()
export class MarketService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<MarketStat[]> {
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

  async getTotals(): Promise<MarketTotals> {
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
            AND "lastValuationUsd" >= ${UNICORN_USD}
        )::int AS unicorns
    `;
    return {
      totalRaisedUsd: row?.totalRaisedUsd ?? 0,
      dealCount: row?.dealCount ?? 0,
      newUnicorns: row?.unicorns ?? 0,
      quarter: currentQuarter(),
    };
  }
}
