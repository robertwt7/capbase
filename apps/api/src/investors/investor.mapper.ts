import {
  INVESTOR_EDIT_FIELDS,
  type Investor,
  type InvestorEditFields,
  type InvestorSummary,
  type InvestorType,
} from '@repo/api';
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
    countryCode: row.countryCode,
    websiteUrl: row.websiteUrl,
    linkedinUrl: row.linkedinUrl,
    domain: row.domain,
    description: row.description,
    fundCount: row.fundCount,
    assetsUsd: numN(row.assetsUsd),
    foundedYear: row.foundedYear,
  };
}

/** The editable fields of a firm row, as an investor proposal diffs them. */
export function toInvestorEditFields(row: DbInvestor): InvestorEditFields {
  const all: Required<InvestorEditFields> = {
    name: row.name,
    legalName: row.legalName,
    type: row.type as InvestorType,
    hq: row.hq,
    countryCode: row.countryCode,
    websiteUrl: row.websiteUrl,
    linkedinUrl: row.linkedinUrl,
    domain: row.domain,
    description: row.description,
    foundedYear: row.foundedYear,
  };
  return Object.fromEntries(INVESTOR_EDIT_FIELDS.map((k) => [k, all[k]])) as InvestorEditFields;
}

/** The firm's values for exactly the keys `changes` touches. */
export function pickInvestorFields(
  row: DbInvestor,
  changes: InvestorEditFields,
): InvestorEditFields {
  const view = toInvestorEditFields(row);
  return Object.fromEntries(
    Object.keys(changes).map((k) => [k, view[k as keyof InvestorEditFields]]),
  ) as InvestorEditFields;
}

/**
 * Investor plus its portfolio facts.
 *
 * `portfolioCount` comes from `_count.holdings` — a live count on the profile,
 * the stored `holdingCount` on the list — not from `holdings.length`: the list
 * read only loads a sample of holdings.
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
