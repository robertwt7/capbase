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
