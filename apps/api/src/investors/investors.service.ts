import { Injectable } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  type InvestorListQuery,
  type InvestorSummary,
  type InvestorType,
  type Paginated,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import { PrismaService } from '../prisma/prisma.service';

/** How many portfolio companies to include in each investor's preview sample. */
const PORTFOLIO_SAMPLE = 6;

interface Accumulator {
  name: string;
  types: InvestorType[];
  companies: Map<string, { slug: string; name: string; domain: string }>;
  sectors: Set<string>;
}

/** Returns the most-frequent value; ties break by first-seen order.
    Callers always pass a non-empty array (a group has at least one holding). */
function mode(values: InvestorType[]): InvestorType {
  const counts = new Map<InvestorType, number>();
  let best: InvestorType = values[0]!;
  let bestCount = 0;
  for (const v of values) {
    const next = (counts.get(v) ?? 0) + 1;
    counts.set(v, next);
    if (next > bestCount) {
      best = v;
      bestCount = next;
    }
  }
  return best;
}

@Injectable()
export class InvestorsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of unique investors derived from approved holdings on approved
   * companies. Grouping happens in SQL (`groupBy` + skip/take); only the page's
   * holdings are loaded to build summaries.
   */
  async findAll(query: InvestorListQuery = {}): Promise<Paginated<InvestorSummary>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.InvestorHoldingWhereInput = {
      moderationStatus: 'APPROVED',
      company: { moderationStatus: 'APPROVED' },
      ...(query.q && { name: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.type && { type: query.type }),
    };

    // Total distinct investors under the filter. groupBy returns one row per
    // name — fine at this scale; swap for a raw COUNT(DISTINCT) if it grows.
    const allGroups = await this.prisma.investorHolding.groupBy({ by: ['name'], where });
    const total = allGroups.length;

    // The page of investor names. Ordering by holding count approximates
    // portfolio size (one holding row per company per investor is the norm);
    // `portfolioCount` below still dedupes companies exactly.
    const pageGroups = await this.prisma.investorHolding.groupBy({
      by: ['name'],
      where,
      orderBy:
        query.sort === 'name'
          ? [{ name: 'asc' }]
          : [{ _count: { name: 'desc' } }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const names = pageGroups.map((g) => g.name);
    if (names.length === 0) return { items: [], total, page, pageSize };

    // Every holding for just this page's investors, with the company facts the
    // summary needs. Note: unfiltered by q/type on purpose — an investor's
    // portfolio is the same whichever filter found them.
    const holdings = await this.prisma.investorHolding.findMany({
      where: {
        name: { in: names },
        moderationStatus: 'APPROVED',
        company: { moderationStatus: 'APPROVED' },
      },
      include: {
        company: {
          select: { slug: true, name: true, domain: true, primarySector: true },
        },
      },
    });

    const groups = new Map<string, Accumulator>();
    for (const holding of holdings) {
      let acc = groups.get(holding.name);
      if (!acc) {
        acc = { name: holding.name, types: [], companies: new Map(), sectors: new Set() };
        groups.set(holding.name, acc);
      }
      acc.types.push(holding.type as InvestorType);
      acc.companies.set(holding.company.slug, {
        slug: holding.company.slug,
        name: holding.company.name,
        domain: holding.company.domain,
      });
      if (holding.company.primarySector) acc.sectors.add(holding.company.primarySector);
    }

    // Preserve the SQL page order.
    const items: InvestorSummary[] = names
      .map((name) => groups.get(name))
      .filter((acc): acc is Accumulator => Boolean(acc))
      .map((acc) => {
        const companies = [...acc.companies.values()].sort((a, b) => a.name.localeCompare(b.name));
        return {
          name: acc.name,
          type: mode(acc.types),
          portfolioCount: companies.length,
          sectors: [...acc.sectors].sort((a, b) => a.localeCompare(b)),
          companies: companies.slice(0, PORTFOLIO_SAMPLE),
        };
      });

    return { items, total, page, pageSize };
  }
}
