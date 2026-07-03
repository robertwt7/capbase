import { Injectable } from '@nestjs/common';
import type { InvestorSummary, InvestorType } from '@repo/api';

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

  /** Unique investors derived from approved holdings on approved companies. */
  async findAll(): Promise<InvestorSummary[]> {
    const holdings = await this.prisma.investorHolding.findMany({
      where: {
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

    const summaries: InvestorSummary[] = [...groups.values()].map((acc) => {
      const companies = [...acc.companies.values()].sort((a, b) => a.name.localeCompare(b.name));
      return {
        name: acc.name,
        type: mode(acc.types),
        portfolioCount: companies.length,
        sectors: [...acc.sectors].sort((a, b) => a.localeCompare(b)),
        companies: companies.slice(0, PORTFOLIO_SAMPLE),
      };
    });

    return summaries.sort(
      (a, b) => b.portfolioCount - a.portfolioCount || a.name.localeCompare(b.name),
    );
  }
}
