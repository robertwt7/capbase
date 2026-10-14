'use client';

import type { CountryFacet } from '@repo/api';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import { countryName, formatCount } from '@/lib/format';

/** The "all" sentinel the directories already use for their other filters. */
export const ALL_COUNTRIES = 'all';

/**
 * A directory's country filter: "All countries" plus each country the API
 * counted, most first, labelled by name with its row count. Text only — the
 * ledger design has no room for flag emoji, which are colour.
 *
 * A code in the URL that the facet list lacks (a hand-edited link, or a list
 * that failed to load) is still offered, so the trigger never renders blank.
 */
export function CountryFilter({
  value,
  onChange,
  countries,
  className,
}: {
  value: string;
  onChange: (code: string) => void;
  countries: CountryFacet[];
  className?: string;
}) {
  const options =
    value !== ALL_COUNTRIES && !countries.some((c) => c.code === value)
      ? [{ code: value, count: null as number | null }, ...countries]
      : countries;

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className} aria-label="All countries">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_COUNTRIES}>All countries</SelectItem>
        {options.map((c) => (
          <SelectItem key={c.code} value={c.code}>
            {countryName(c.code) ?? c.code}
            {c.count !== null ? (
              <span className="ml-1.5 font-mono text-[11px] text-graphite-500">{formatCount(c.count)}</span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
