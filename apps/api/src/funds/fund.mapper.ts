import type {
  Fund,
  FundCommitmentRow,
  FundMetricRow,
  FundStatus,
  FundStrategy,
  FundSummary,
  FundTerms,
  InvestorType,
} from '@repo/api';
import type {
  Fund as DbFund,
  FundCommitment as DbFundCommitment,
  FundMetric as DbFundMetric,
  Investor as DbInvestor,
} from '@repo/db';

/** The row shape the directory read produces: a fund plus its manager. */
export type FundWithManager = DbFund & {
  manager: Pick<DbInvestor, 'slug' | 'name' | 'domain'>;
};

/** A commitment with the LP it belongs to. */
export type CommitmentWithInvestor = DbFundCommitment & {
  investor: Pick<DbInvestor, 'slug' | 'name' | 'type'>;
};

const numN = (v: bigint | null): number | null => (v === null ? null : Number(v));
const dateN = (v: Date | null): string | null => (v === null ? null : v.toISOString().slice(0, 10));

export function toFund(row: DbFund): Fund {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    strategy: row.strategy as FundStrategy | null,
    status: row.status as FundStatus | null,
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

export function toFundTerms(row: DbFund): FundTerms {
  return {
    launchDate: dateN(row.launchDate),
    latestCloseDate: dateN(row.latestCloseDate),
    finalCloseDate: dateN(row.finalCloseDate),
    hardCapUsd: numN(row.hardCapUsd),
    managementFeePct: row.managementFeePct,
    carriedInterestPct: row.carriedInterestPct,
    hurdleRatePct: row.hurdleRatePct,
    targetIrrNetMinPct: row.targetIrrNetMinPct,
    targetIrrNetMaxPct: row.targetIrrNetMaxPct,
    targetIrrGrossMinPct: row.targetIrrGrossMinPct,
    targetIrrGrossMaxPct: row.targetIrrGrossMaxPct,
    regionFocus: row.regionFocus,
  };
}

export function toFundCommitmentRow(row: CommitmentWithInvestor): FundCommitmentRow {
  return {
    id: row.id,
    investor: {
      slug: row.investor.slug,
      name: row.investor.name,
      type: row.investor.type as InvestorType,
    },
    amountUsd: numN(row.amountUsd),
    amountLocal: numN(row.amountLocal),
    currency: row.currency,
  };
}

export function toFundMetricRow(row: DbFundMetric): FundMetricRow {
  return {
    asAt: row.asAt.toISOString().slice(0, 10),
    aumUsd: numN(row.aumUsd),
    dryPowderUsd: numN(row.dryPowderUsd),
    unrealizedUsd: numN(row.unrealizedUsd),
  };
}
