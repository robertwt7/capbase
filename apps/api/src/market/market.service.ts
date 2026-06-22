import { Injectable, NotFoundException } from '@nestjs/common';
import type { MarketStat, MarketTotals } from '@repo/api';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MarketService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<MarketStat[]> {
    const rows = await this.prisma.marketStat.findMany({
      orderBy: { totalRaisedUsd: 'desc' },
    });
    return rows.map((s) => ({
      sector: s.sector,
      dealCount: s.dealCount,
      totalRaisedUsd: Number(s.totalRaisedUsd),
      medianValuationUsd: Number(s.medianValuationUsd),
      trendPct: s.trendPct,
    }));
  }

  async getTotals(): Promise<MarketTotals> {
    const row = await this.prisma.marketSnapshot.findFirst();
    if (!row) throw new NotFoundException('Market snapshot not available');
    return {
      totalRaisedUsd: Number(row.totalRaisedUsd),
      dealCount: row.dealCount,
      newUnicorns: row.newUnicorns,
      quarter: row.quarter,
    };
  }
}
