import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  type Citation,
  type InvestorDetailResponse,
  type InvestorListQuery,
  type InvestorSlugEntry,
  type InvestorSummary,
  type Paginated,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import { toFund } from '../funds/fund.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { toCitation } from '../provenance/citation.mapper';
import { toInvestorSummary, type InvestorWithHoldings } from './investor.mapper';

/** How many portfolio companies to include in each investor's preview sample. */
const PORTFOLIO_SAMPLE = 6;

/** How many named funds the profile shows before linking to /funds. The SPV
 *  platforms report tens of thousands, so this is a preview, not a list. */
export const FUND_PREVIEW = 12;

/** Funds are ingest-only and auto-APPROVED; the filter matches every sibling
 *  read so a later contribution path needs no change here. */
const PUBLIC_FUNDS = { moderationStatus: 'APPROVED' } satisfies Prisma.FundWhereInput;

/** Only approved holdings on approved companies count towards a portfolio. */
const PUBLIC_HOLDINGS = {
  moderationStatus: 'APPROVED',
  company: { moderationStatus: 'APPROVED' },
} satisfies Prisma.InvestorHoldingWhereInput;

const COMPANY_SELECT = {
  select: { slug: true, name: true, domain: true, primarySector: true },
};

@Injectable()
export class InvestorsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of investors, read straight from the Investor table.
   *
   * Investors with no known portfolio are included on purpose: the SEC Form ADV
   * universe is mostly firms whose investments no free source discloses, and
   * their profiles invite a contribution rather than hiding.
   */
  async findAll(query: InvestorListQuery = {}): Promise<Paginated<InvestorSummary>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.InvestorWhereInput = {
      moderationStatus: 'APPROVED',
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.type && { type: query.type }),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.investor.count({ where }),
      this.prisma.investor.findMany({
        where,
        orderBy:
          query.sort === 'name'
            ? [{ name: 'asc' }]
            : [{ holdings: { _count: 'desc' } }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          holdings: {
            where: PUBLIC_HOLDINGS,
            take: PORTFOLIO_SAMPLE,
            include: { company: COMPANY_SELECT },
          },
          _count: { select: { holdings: { where: PUBLIC_HOLDINGS } } },
        },
      }),
    ]);

    return { items: rows.map((r) => toInvestorSummary(r as InvestorWithHoldings)), total, page, pageSize };
  }

  /** Full profile: the whole approved portfolio, not a sample, plus the largest
   *  funds we can name and the citations attesting them. */
  async findOne(slug: string): Promise<InvestorDetailResponse> {
    const row = await this.prisma.investor.findFirst({
      where: { slug, moderationStatus: 'APPROVED' },
      include: {
        holdings: {
          where: PUBLIC_HOLDINGS,
          include: { company: COMPANY_SELECT },
        },
        funds: {
          where: PUBLIC_FUNDS,
          orderBy: [{ grossAssetsUsd: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
          take: FUND_PREVIEW,
        },
        _count: {
          select: { holdings: { where: PUBLIC_HOLDINGS }, funds: { where: PUBLIC_FUNDS } },
        },
      },
    });
    if (!row) throw new NotFoundException(`Investor "${slug}" not found`);

    const funds = row.funds.map(toFund);
    return {
      ...toInvestorSummary(row as unknown as InvestorWithHoldings),
      funds,
      // What we can name, as against `fundCount` — what the firm told the SEC.
      namedFundCount: row._count.funds,
      citations: await this.loadFundCitations(funds.map((f) => f.id)),
    };
  }

  /** Citations attaching to the fund rows in the response, in one query over a
   *  bounded id list — the same shape the company profile uses. */
  private async loadFundCitations(ids: string[]): Promise<Citation[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.citation.findMany({
      where: { entityType: 'fund', entityId: { in: ids } },
      include: { source: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toCitation);
  }

  /** Every approved investor slug, for the web sitemap. */
  async listSlugs(): Promise<InvestorSlugEntry[]> {
    const rows = await this.prisma.investor.findMany({
      where: { moderationStatus: 'APPROVED' },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
  }
}
