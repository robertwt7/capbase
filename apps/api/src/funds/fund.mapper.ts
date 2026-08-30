import type { Fund, FundStrategy, FundSummary } from '@repo/api';
import type { Fund as DbFund, Investor as DbInvestor } from '@repo/db';

/** The row shape the directory read produces: a fund plus its manager. */
export type FundWithManager = DbFund & {
  manager: Pick<DbInvestor, 'slug' | 'name' | 'domain'>;
};

const numN = (v: bigint | null): number | null => (v === null ? null : Number(v));

export function toFund(row: DbFund): Fund {
  return {
    id: row.id,
    name: row.name,
    strategy: row.strategy as FundStrategy | null,
    vintageYear: row.vintageYear,
    targetUsd: numN(row.targetUsd),
    closedUsd: numN(row.closedUsd),
    grossAssetsUsd: numN(row.grossAssetsUsd),
    currency: row.currency,
    hq: row.hq,
  };
}

export function toFundSummary(row: FundWithManager): FundSummary {
  return {
    ...toFund(row),
    manager: { slug: row.manager.slug, name: row.manager.name, domain: row.manager.domain },
  };
}
