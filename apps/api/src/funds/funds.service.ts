import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  FUND_COMMITMENT_PREVIEW,
  SITEMAP_PAGE_SIZE,
  fundIndexable,
  type FundDetailResponse,
  type FundListQuery,
  type FundSlugEntry,
  type FundSummary,
  type Paginated,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_INVESTOR } from '../prisma/public-filters';
import { toCitation } from '../provenance/citation.mapper';
import {
  toFundCommitmentRow,
  toFundMetricRow,
  toFundSummary,
  toFundTerms,
  type CommitmentWithInvestor,
  type FundWithManager,
} from './fund.mapper';

const MANAGER_SELECT = { select: { slug: true, name: true, domain: true } };

/** Funds are ingest-only and auto-APPROVED; the filter matches every sibling. */
const PUBLIC_FUND = { moderationStatus: 'APPROVED' } satisfies Prisma.FundWhereInput;

/** A commitment is public when it is approved and its LP is a live, public
 *  firm — a merged-away LP's row would otherwise link to a tombstone. */
export const PUBLIC_FUND_COMMITMENTS = {
  moderationStatus: 'APPROVED',
  investor: PUBLIC_INVESTOR,
} satisfies Prisma.FundCommitmentWhereInput;

/** `fundIndexable` (`@repo/api`) restated as a query — the sitemap's filter. */
const INDEXABLE_FUND = {
  ...PUBLIC_FUND,
  slug: { not: null },
  OR: [
    { commitments: { some: PUBLIC_FUND_COMMITMENTS } },
    { closedUsd: { not: null } },
    { targetUsd: { not: null } },
    { finalCloseDate: { not: null } },
    { managementFeePct: { not: null } },
  ],
} satisfies Prisma.FundWhereInput;

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
      ...PUBLIC_FUND,
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.strategy && { strategy: query.strategy }),
      ...(query.status && { status: query.status }),
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

  /** The fund page: facts, terms, the largest commitments, metrics, and the
   *  citations SEC funds carry. 404 for an unknown or unpublished fund. */
  async findOne(slug: string): Promise<FundDetailResponse> {
    const row = await this.prisma.fund.findFirst({
      where: { slug, ...PUBLIC_FUND },
      include: {
        manager: MANAGER_SELECT,
        commitments: {
          where: PUBLIC_FUND_COMMITMENTS,
          orderBy: [{ amountUsd: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
          take: FUND_COMMITMENT_PREVIEW,
          include: { investor: { select: { slug: true, name: true, type: true } } },
        },
        metrics: { orderBy: { asAt: 'asc' } },
        _count: { select: { commitments: { where: PUBLIC_FUND_COMMITMENTS } } },
      },
    });
    if (!row) throw new NotFoundException(`Fund "${slug}" not found`);

    const citations = await this.prisma.citation.findMany({
      where: { entityType: 'fund', entityId: row.id },
      include: { source: true },
      orderBy: { createdAt: 'asc' },
    });

    const summary = toFundSummary(row as FundWithManager);
    const terms = toFundTerms(row);
    const commitmentCount = row._count.commitments;
    return {
      fund: { ...summary, ...terms },
      commitments: row.commitments.map((c) => toFundCommitmentRow(c as CommitmentWithInvestor)),
      commitmentCount,
      metrics: row.metrics.map(toFundMetricRow),
      citations: citations.map(toCitation),
      indexable: fundIndexable({
        commitmentCount,
        closedUsd: summary.closedUsd,
        targetUsd: summary.targetUsd,
        finalCloseDate: terms.finalCloseDate,
        managementFeePct: terms.managementFeePct,
      }),
    };
  }

  /**
   * Every INDEXABLE fund slug, for the sitemap. Restates `fundIndexable` (in
   * `@repo/api`) as a Prisma filter — keep the two in step.
   */
  /** One `SITEMAP_PAGE_SIZE` page of the indexable funds, by slug. */
  async listSlugs(page = 0): Promise<FundSlugEntry[]> {
    const rows = await this.prisma.fund.findMany({
      where: INDEXABLE_FUND,
      select: { slug: true, updatedAt: true },
      orderBy: { slug: 'asc' },
      skip: page * SITEMAP_PAGE_SIZE,
      take: SITEMAP_PAGE_SIZE,
    });
    return rows.map((r) => ({ slug: r.slug!, updatedAt: r.updatedAt.toISOString() }));
  }

  countSlugs(): Promise<number> {
    return this.prisma.fund.count({ where: INDEXABLE_FUND });
  }
}

/**
 * Default sort is by size, deliberately.
 *
 * AngelList-style SPV platforms report tens of thousands of near-empty funds
 * (one filer alone reports 22,277, some with $101 of gross assets). Sorting by
 * name or vintage would let them own every page; sorting by size puts the funds
 * a reader came for first. `sizeUsd` is the figure the row shows (gross assets,
 * else capital closed), so a partner fund with a size but no Form ADV NAV ranks
 * by it. Nulls sort last either way — an unreported value is not a small one.
 */
export function fundOrderBy(sort: FundListQuery['sort']): Prisma.FundOrderByWithRelationInput[] {
  if (sort === 'name') return [{ name: 'asc' }];
  if (sort === 'vintage') return [{ vintageYear: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }];
  return [{ sizeUsd: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }];
}
