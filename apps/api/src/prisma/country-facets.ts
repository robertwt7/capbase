import type { CountryFacet } from '@repo/api';

/** groupBy rows → facets, most first, ties by code so the order is stable. */
export function toFacets(
  rows: { countryCode: string | null; _count: { _all: number } }[],
): CountryFacet[] {
  return rows
    .filter((r): r is { countryCode: string; _count: { _all: number } } => !!r.countryCode)
    .map((r) => ({ code: r.countryCode, count: r._count._all }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}
