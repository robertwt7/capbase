// Money and number formatting used across the data-dense views.

import { countryName as isoCountryName } from '@repo/api';

const symbols = new Map<string, string>();

/** The currency's narrow symbol ($, £, €), or "CODE " when the locale has
 *  none — never a guess. Cached: Intl formatters are not free to build. */
function currencySymbol(currency: string): string {
  const code = currency.toUpperCase();
  let symbol = symbols.get(code);
  if (symbol === undefined) {
    try {
      const part = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value;
      symbol = part && part !== code ? part : `${code} `;
    } catch {
      symbol = `${code} `;
    }
    symbols.set(code, symbol);
  }
  return symbol;
}

/** Compact money in its own currency: £425K, €1.2M, $24B. Same rounding rules
 *  as `formatUsd`, which is this with USD. */
export function formatMoney(amount: number | null, currency = 'USD'): string {
  if (amount === null) return 'Undisclosed';
  const symbol = currencySymbol(currency);
  if (amount >= 1_000_000_000) {
    return `${symbol}${trim(amount / 1_000_000_000)}B`;
  }
  if (amount >= 1_000_000) {
    return `${symbol}${trim(amount / 1_000_000)}M`;
  }
  if (amount >= 1_000) {
    return `${symbol}${trim(amount / 1_000)}K`;
  }
  return `${symbol}${Math.round(amount)}`;
}

export function formatUsd(amount: number | null): string {
  return formatMoney(amount, 'USD');
}

/** English name for an ISO alpha-2 code ("GB" → "United Kingdom"), or null. */
export function countryName(code: string | null | undefined): string | null {
  return isoCountryName(code);
}

function trim(value: number): string {
  // One decimal, but drop a trailing ".0" so $24B beats $24.0B.
  return value.toFixed(1).replace(/\.0$/, '');
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Headline count, rounded DOWN so it never overstates: 36,029 → "36K+",
 * 7,810 → "7.8K+", 1,240,000 → "1.2M+". Exact below 1,000.
 */
export function formatCountCompact(value: number): string {
  const floor1 = (n: number) => (Math.floor(n * 10) / 10).toString();
  if (value >= 1_000_000) return `${floor1(value / 1_000_000).replace(/\.0$/, '')}M+`;
  if (value >= 10_000) return `${Math.floor(value / 1_000)}K+`;
  if (value >= 1_000) return `${floor1(value / 1_000).replace(/\.0$/, '')}K+`;
  return formatCount(value);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
  });
}

export function formatYear(iso: string): string {
  return new Date(iso).getFullYear().toString();
}

export function signedPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}%`;
}

/** `Company.founded` is 0 when no source recorded it — never show that as a year. */
export function foundedYear(year: number): string | null {
  return year > 0 ? String(year) : null;
}

/** A percentage as published (2 → "2%", 1.75 → "1.75%"), or an em dash when
 *  the source states none. Never "0%" for unknown. */
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Number(value.toFixed(2))}%`;
}

/** A target range ("15–20%"), one bound ("15%"), or an em dash. */
export function formatPctRange(min: number | null | undefined, max: number | null | undefined): string {
  if (min != null && max != null && min !== max) return `${Number(min.toFixed(2))}–${formatPct(max)}`;
  return formatPct(min ?? max);
}
