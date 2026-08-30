import type { FundStrategy } from '@repo/api';

import type { CsvRow } from '../../util/csv';
import { titleCaseFirm } from '../../util/text';
import type { NormalizedFund } from '../ingestion-source';

export const SEC_ADV_FUNDS = 'SEC_ADV_FUNDS';

/**
 * Schedule D 7.B.(1) `Fund Type` → the shared vocabulary.
 *
 * Exhaustive over the seven values observed across all 95,538 rows; anything
 * unrecognised is 'Other', never dropped and never guessed at from the name.
 */
const ADV_FUND_TYPES: Record<string, FundStrategy> = {
  'Venture Capital Fund': 'Venture capital',
  'Private Equity Fund': 'Private equity',
  'Hedge Fund': 'Hedge fund',
  'Real Estate Fund': 'Real estate',
  'Securitized Asset Fund': 'Securitized asset',
  'Liquidity Fund': 'Liquidity',
  'Other Private Fund': 'Other',
};

export function fundStrategyForAdv(fundType: string | undefined): FundStrategy {
  const key = (fundType ?? '').trim();
  if (!key) return 'Other';
  const exact = ADV_FUND_TYPES[key];
  if (exact) return exact;
  const ci = Object.keys(ADV_FUND_TYPES).find((k) => k.toLowerCase() === key.toLowerCase());
  return ci ? ADV_FUND_TYPES[ci]! : 'Other';
}

/** Numeric cell → number, or null when nothing was reported. Same handling of
 *  the bare ".00" the SEC writes for "no value" as the roster parser, but null
 *  rather than 0: a fund with no reported NAV has not reported $0. */
function num(value: string | undefined): number | null {
  const cleaned = (value ?? '').replace(/[,\s$]/g, '');
  if (!cleaned || cleaned === '.00') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Schedule D gives no city, only state and country. */
function hqOf(row: CsvRow): string | null {
  const parts = [(row['State'] ?? '').trim(), (row['Country'] ?? '').trim()].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Map one Schedule D 7.B.(1) row to a fund.
 *
 * `crd` comes from the filing's `1E1` in the matching `*_ADV_Base` file —
 * Schedule D itself carries only a `FilingID`. Rows with no fund name are
 * dropped: a nameless fund cannot be matched to a Form D filing or rendered.
 *
 * Note what is NOT here: vintage year, target size and capital closed. Form ADV
 * asks for none of them — `Gross Asset Value` is NAV as of the filing, a
 * different fact from capital raised. Those come from pooled Form D filings.
 */
export function mapScheduleDRow(row: CsvRow, crd: string): NormalizedFund | null {
  const rawName = (row['Fund Name'] ?? '').trim();
  if (!rawName) return null;

  const fundId = (row['Fund ID'] ?? '').trim();

  return {
    // The SEC private fund id is the stable identity; a fund that reports none
    // falls back to its manager plus its name, which is unique within a filer.
    externalId: fundId || `${crd}|${rawName.toLowerCase()}`,
    // ADV stores names ALL CAPS; titleCaseFirm keeps the roman numerals that
    // distinguish one vintage of a fund family from the next.
    name: titleCaseFirm(rawName),
    managerCrd: crd,
    strategy: fundStrategyForAdv(row['Fund Type']),
    vintageYear: null,
    targetUsd: null,
    closedUsd: null,
    grossAssetsUsd: num(row['Gross Asset Value']),
    hq: hqOf(row),
    secFundId: fundId || null,
    cikNumber: null,
  };
}
