export interface MarketStat {
  sector: string;
  companyCount: number; // approved companies in the sector
  dealCount: number; // approved rounds on approved companies in the sector
  totalRaisedUsd: number;
  medianValuationUsd: number;
  trendPct: number; // deal-volume change, trailing 90 days vs the 90 days before
}

export interface MarketTotals {
  totalRaisedUsd: number;
  dealCount: number;
  newUnicorns: number;
  quarter: string;
}
