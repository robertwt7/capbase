import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  type Citation,
  type EntityIdentifierRef,
  type InvestorDetailResponse,
  type InvestorListQuery,
  type InvestorSlugEntry,
  type InvestorSummary,
  type Paginated,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import { toFund } from '../funds/fund.mapper';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_MERGE_HOPS,
  PUBLIC_COMPANY_RELATION,
  PUBLIC_INVESTOR,
} from '../prisma/public-filters';
import { toCitation } from '../provenance/citation.mapper';
import { toEntityIdentifiers } from '../provenance/identifier.mapper';
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
  company: PUBLIC_COMPANY_RELATION,
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
      ...PUBLIC_INVESTOR,
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
      where: { slug, ...PUBLIC_INVESTOR },
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
    // Returns `never` — either a 301 to the survivor, or a 404.
    if (!row) return this.redirectOrNotFound(slug);

    const funds = row.funds.map(toFund);
    return {
      ...toInvestorSummary(row as unknown as InvestorWithHoldings),
      identifiers: await this.loadIdentifiers(row.id),
      funds,
      // What we can name, as against `fundCount` — what the firm told the SEC.
      namedFundCount: row._count.funds,
      citations: await this.loadFundCitations(funds.map((f) => f.id)),
    };
  }

  /**
   * A slug no live investor answers to: either a tombstone, or nothing. Always
   * throws.
   *
   * 301 with the survivor's slug in the body and deliberately **no** `Location`
   * header — see the identical note on CompaniesService. With one, the web
   * app's server-side fetch would follow it and render the survivor under the
   * old URL instead of moving the browser.
   */
  private async redirectOrNotFound(slug: string): Promise<never> {
    const survivor = await this.resolveMerged(slug);
    if (survivor) {
      throw new HttpException(
        { message: `Investor "${slug}" was merged`, redirectTo: survivor, statusCode: 301 },
        HttpStatus.MOVED_PERMANENTLY,
      );
    }
    throw new NotFoundException(`Investor "${slug}" not found`);
  }

  /** Follow a chain of merges to the live row at the end of it, or null. Capped
   *  so a cycle cannot hang the request. */
  private async resolveMerged(slug: string): Promise<string | null> {
    let row = await this.prisma.investor.findUnique({
      where: { slug },
      select: { slug: true, mergedIntoId: true, moderationStatus: true },
    });
    if (!row?.mergedIntoId) return null;

    let next: string | null = row.mergedIntoId;
    for (let hop = 0; hop < MAX_MERGE_HOPS && next; hop++) {
      row = await this.prisma.investor.findUnique({
        where: { id: next },
        select: { slug: true, mergedIntoId: true, moderationStatus: true },
      });
      if (!row) return null;
      if (!row.mergedIntoId) {
        return row.moderationStatus === 'APPROVED' ? row.slug : null;
      }
      next = row.mergedIntoId;
    }
    return null;
  }

  /** The firm's external identifiers (CRD, CIK, LEI, QID) for the crosswalk
   *  block. Detail read only — the directory list stays one query. */
  private async loadIdentifiers(investorId: string): Promise<EntityIdentifierRef[]> {
    const rows = await this.prisma.entityIdentifier.findMany({
      where: { entityType: 'investor', entityId: investorId },
    });
    return toEntityIdentifiers(rows);
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
      where: PUBLIC_INVESTOR,
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
  }
}
