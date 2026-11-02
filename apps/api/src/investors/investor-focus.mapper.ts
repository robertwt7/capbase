import type { InvestorFocus, LpFocus, ManagerFocus, ReportedRange } from '@repo/api';
import type { InvestorFocus as DbInvestorFocus } from '@repo/db';

const numN = (v: bigint | null): number | null => (v === null ? null : Number(v));
const day = (d: Date): string => d.toISOString().slice(0, 10);

/** Null when neither bound was reported. Local bounds only for a non-USD range. */
function rangeOf(row: DbInvestorFocus): ReportedRange | null {
  if (row.rangeMinUsd === null && row.rangeMaxUsd === null) return null;
  const local = row.rangeCurrency !== 'USD';
  return {
    minUsd: numN(row.rangeMinUsd),
    maxUsd: numN(row.rangeMaxUsd),
    currency: row.rangeCurrency,
    minLocal: local ? numN(row.rangeMinLocal) : null,
    maxLocal: local ? numN(row.rangeMaxLocal) : null,
  };
}

/** Rows ordered newest `reportedOn` first, then `externalId` — the first row of
 *  each role wins (a merge or a second partner id can leave two). */
export function toInvestorFocus(rows: DbInvestorFocus[]): InvestorFocus | null {
  let manager: ManagerFocus | null = null;
  let lp: LpFocus | null = null;
  for (const r of rows) {
    if (r.role === 'manager' && !manager) {
      manager = {
        stages: r.stages,
        mainStrategy: r.mainStrategy,
        strategies: r.strategies,
        industries: r.industries,
        verticals: r.verticals,
        geographicExposure: r.geographies,
        initialEquityInvestment: rangeOf(r),
        reportedOn: day(r.reportedOn),
      };
    } else if (r.role === 'lp' && !lp) {
      lp = {
        strategyPreferences: r.strategies,
        industries: r.industries,
        verticals: r.verticals,
        geographicPreferences: r.geographies,
        typicalCommitment: rangeOf(r),
        reportedOn: day(r.reportedOn),
      };
    }
  }
  return manager || lp ? { manager, lp } : null;
}
