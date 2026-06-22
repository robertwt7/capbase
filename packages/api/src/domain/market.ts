export interface MarketStat {
  sector: string;
  dealCount: number;
  totalRaisedUsd: number;
  medianValuationUsd: number;
  trendPct: number; // quarter-over-quarter change in deal volume
}

export interface MarketTotals {
  totalRaisedUsd: number;
  dealCount: number;
  newUnicorns: number;
  quarter: string;
}
