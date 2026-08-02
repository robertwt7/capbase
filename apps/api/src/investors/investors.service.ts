import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  type InvestorDetailResponse,
  type InvestorListQuery,
  type InvestorSlugEntry,
  type InvestorSummary,
  type Paginated,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import { PrismaService } from '../prisma/prisma.service';
import { toInvestorSummary, type InvestorWithHoldings } from './investor.mapper';

/** How many portfolio companies to include in each investor's preview sample. */
const PORTFOLIO_SAMPLE = 6;

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

  /** Full profile: the whole approved portfolio, not a sample. */
  async findOne(slug: string): Promise<InvestorDetailResponse> {
    const row = await this.prisma.investor.findFirst({
      where: { slug, moderationStatus: 'APPROVED' },
      include: {
        holdings: {
          where: PUBLIC_HOLDINGS,
          include: { company: COMPANY_SELECT },
        },
        _count: { select: { holdings: { where: PUBLIC_HOLDINGS } } },
      },
    });
    if (!row) throw new NotFoundException(`Investor "${slug}" not found`);
    return toInvestorSummary(row as InvestorWithHoldings);
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
