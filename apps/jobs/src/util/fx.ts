import { unzipSync } from 'fflate';

/** ECB euro foreign exchange reference rates, full history since 1999-01-04:
 *  one row per TARGET business day, each rate in units per 1 EUR. */
export const ECB_HIST_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip';

const REQUEST_TIMEOUT_MS = 60_000;

/** How far back a missing day may borrow a rate from: weekends, bank holidays
 *  and the Christmas closure, never a stale quarter. */
const MAX_LOOKBACK_DAYS = 10;

const DAY_MS = 86_400_000;

/**
 * Historical exchange rates, read from the ECB's reference-rate history.
 *
 * Used to give a non-USD round the comparable `amountUsd` every sort, total and
 * bar width reads, at the rate of the day the money was committed — not
 * today's rate, which would make a 2005 grant move every time sterling does.
 */
export class FxTable {
  /** Ascending ISO dates. */
  private readonly dates: string[];
  /** currency → rate per EUR, aligned with `dates`; NaN where the ECB has N/A. */
  private readonly rates: Map<string, number[]>;

  private constructor(dates: string[], rates: Map<string, number[]>) {
    this.dates = dates;
    this.rates = rates;
  }

  /** Parse eurofxref-hist.csv (`Date,USD,JPY,…,GBP,…`, newest first, a trailing
   *  comma on every line, `N/A` for a currency not quoted that day). */
  static parse(csv: string): FxTable {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
    const header = (lines[0] ?? '').split(',').map((h) => h.trim());
    const rows = lines
      .slice(1)
      .map((l) => l.split(','))
      .filter((cells) => /^\d{4}-\d{2}-\d{2}$/.test((cells[0] ?? '').trim()))
      .sort((a, b) => a[0]!.trim().localeCompare(b[0]!.trim()));

    const dates = rows.map((cells) => cells[0]!.trim());
    const rates = new Map<string, number[]>();
    header.forEach((currency, col) => {
      if (col === 0 || !/^[A-Z]{3}$/.test(currency)) return;
      rates.set(
        currency,
        rows.map((cells) => {
          const n = Number((cells[col] ?? '').trim());
          return Number.isFinite(n) && n > 0 ? n : NaN;
        }),
      );
    });
    return new FxTable(dates, rates);
  }

  /**
   * Units of USD per 1 unit of `currency` on `isoDate`.
   *
   * Uses that date, or the nearest PREVIOUS business day within
   * MAX_LOOKBACK_DAYS on which both currencies were quoted. A date after the
   * last published row uses the last row (an award dated next month is still
   * worth converting today). Null before 1999-01-04, for an unknown currency,
   * or when no quote lies inside the window.
   */
  usdPer(currency: string, isoDate: string): number | null {
    const code = currency.trim().toUpperCase();
    if (code === 'USD') return 1;
    const usd = this.rates.get('USD');
    const other = code === 'EUR' ? null : this.rates.get(code);
    if (!usd || (code !== 'EUR' && !other)) return null;
    if (this.dates.length === 0 || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return null;

    const day = isoDate.slice(0, 10);
    const last = this.dates.length - 1;
    const afterEnd = day > this.dates[last]!;
    let i = afterEnd ? last : this.floorIndex(day);
    if (i < 0) return null;

    const anchor = Date.parse(afterEnd ? this.dates[last]! : day);
    for (; i >= 0; i--) {
      if ((anchor - Date.parse(this.dates[i]!)) / DAY_MS > MAX_LOOKBACK_DAYS) return null;
      const usdPerEur = usd[i]!;
      const otherPerEur = other ? other[i]! : 1;
      if (Number.isNaN(usdPerEur) || Number.isNaN(otherPerEur)) continue;
      return usdPerEur / otherPerEur;
    }
    return null;
  }

  /** Index of the last date ≤ `day`, or -1. */
  private floorIndex(day: string): number {
    let lo = 0;
    let hi = this.dates.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.dates[mid]! <= day) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }
}

/** Download and unzip the history (~640 KB zipped, ~2 MB of CSV) once per run.
 *  Throws on failure: converting money without a rate would publish a wrong
 *  figure, so a source that needs this must not run without it. */
export async function loadFxTable(): Promise<FxTable> {
  const res = await fetch(ECB_HIST_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${ECB_HIST_URL} -> ${res.status}`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()), {
    filter: (f) => f.name.endsWith('.csv'),
  });
  const csv = Object.values(files)[0];
  if (!csv) throw new Error(`${ECB_HIST_URL} contained no CSV`);
  return FxTable.parse(new TextDecoder('utf-8').decode(csv));
}
