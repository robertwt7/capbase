import { Injectable } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  type FundListQuery,
  type FundSummary,
  type Paginated,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import { PrismaService } from '../prisma/prisma.service';
import { toFundSummary, type FundWithManager } from './fund.mapper';

const MANAGER_SELECT = { select: { slug: true, name: true, domain: true } };

/**
 * Read side for private funds.
 *
 * Funds are ingest-only and auto-APPROVED, but the read still filters on
 * `moderationStatus` so it matches every sibling table and a later ticket can
 * open contributions without touching this file.
 */
@Injectable()
export class FundsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: FundListQuery = {}): Promise<Paginated<FundSummary>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.FundWhereInput = {
      moderationStatus: 'APPROVED',
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.strategy && { strategy: query.strategy }),
      ...(query.manager && { manager: { slug: query.manager } }),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.fund.count({ where }),
      this.prisma.fund.findMany({
        where,
        orderBy: fundOrderBy(query.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { manager: MANAGER_SELECT },
      }),
    ]);

    return {
      items: rows.map((r) => toFundSummary(r as FundWithManager)),
      total,
      page,
      pageSize,
    };
  }
}

/**
 * Default sort is by size, deliberately.
 *
 * AngelList-style SPV platforms report tens of thousands of near-empty funds
 * (one filer alone reports 22,277, some with $101 of gross assets). Sorting by
 * name or vintage would let them own every page; sorting by gross assets puts
 * the funds a reader came for first. Nulls sort last either way — an unreported
 * value is not a small one.
 */
export function fundOrderBy(sort: FundListQuery['sort']): Prisma.FundOrderByWithRelationInput[] {
  if (sort === 'name') return [{ name: 'asc' }];
  if (sort === 'vintage') return [{ vintageYear: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }];
  return [{ grossAssetsUsd: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }];
}
