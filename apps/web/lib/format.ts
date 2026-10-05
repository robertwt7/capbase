// Money and number formatting used across the data-dense views.

export function formatUsd(amount: number | null): string {
  if (amount === null) return 'Undisclosed';
  if (amount >= 1_000_000_000) {
    return `$${trim(amount / 1_000_000_000)}B`;
  }
  if (amount >= 1_000_000) {
    return `$${trim(amount / 1_000_000)}M`;
  }
  if (amount >= 1_000) {
    return `$${trim(amount / 1_000)}K`;
  }
  return `$${amount}`;
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
