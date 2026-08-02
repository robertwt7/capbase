import type { Investor, InvestorSummary, InvestorType } from '@repo/api';
import type { Investor as DbInvestor, InvestorHolding as DbInvestorHolding } from '@repo/db';

type HoldingWithCompany = DbInvestorHolding & {
  company: { slug: string; name: string; domain: string; primarySector: string | null };
};

/** The row shape both list and detail reads produce. */
export type InvestorWithHoldings = DbInvestor & {
  holdings: HoldingWithCompany[];
  _count: { holdings: number };
};

const numN = (v: bigint | null): number | null => (v === null ? null : Number(v));

export function toInvestor(row: DbInvestor): Investor {
  return {
    slug: row.slug,
    name: row.name,
    legalName: row.legalName,
    type: row.type as InvestorType,
    hq: row.hq,
    websiteUrl: row.websiteUrl,
    linkedinUrl: row.linkedinUrl,
    domain: row.domain,
    description: row.description,
    fundCount: row.fundCount,
    assetsUsd: numN(row.assetsUsd),
    foundedYear: row.foundedYear,
  };
}

/**
 * Investor plus its portfolio facts.
 *
 * `portfolioCount` comes from the filtered relation count, not from
 * `holdings.length` — the list read only loads a sample of holdings.
 */
export function toInvestorSummary(row: InvestorWithHoldings): InvestorSummary {
  const companies = row.holdings
    .map((h) => ({ slug: h.company.slug, name: h.company.name, domain: h.company.domain }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const sectors = [
    ...new Set(row.holdings.map((h) => h.company.primarySector).filter((s): s is string => Boolean(s))),
  ].sort((a, b) => a.localeCompare(b));

  return {
    ...toInvestor(row),
    portfolioCount: row._count.holdings,
    sectors,
    companies,
  };
}
