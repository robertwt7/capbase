'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { INVESTOR_TYPES, type InvestorSummary } from '@repo/api';

import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { formatCount } from '@/lib/format';

const ALL = 'all';

type Sort = 'portfolio' | 'name';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'portfolio', label: 'Portfolio size' },
  { value: 'name', label: 'Name' },
];

const isSort = (v: string | undefined): v is Sort => v === 'portfolio' || v === 'name';

export function InvestorDirectory({
  investors,
  initial,
}: {
  investors: InvestorSummary[];
  initial: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [q, setQ] = useState(initial.q ?? '');
  const [type, setType] = useState(initial.type ?? ALL);
  const [sort, setSort] = useState<Sort>(isSort(initial.sort) ? initial.sort : 'portfolio');

  // Mirror filter state to the URL (debounced), dropping empty / default keys.
  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (type !== ALL) params.set('type', type);
    if (sort !== 'portfolio') params.set('sort', sort);
    const query = params.toString();
    const t = setTimeout(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [q, type, sort, pathname, router]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = investors.filter((inv) => {
      if (needle && !inv.name.toLowerCase().includes(needle)) return false;
      if (type !== ALL && inv.type !== type) return false;
      return true;
    });
    const sorted = [...list];
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else
      sorted.sort(
        (a, b) => b.portfolioCount - a.portfolioCount || a.name.localeCompare(b.name),
      );
    return sorted;
  }, [investors, q, type, sort]);

  const active = q.trim() !== '' || type !== ALL || sort !== 'portfolio';
  const clear = () => {
    setQ('');
    setType(ALL);
    setSort('portfolio');
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search investors"
          aria-label="Search investors"
          className="h-11 max-w-xs flex-1 basis-56"
        />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[170px]" aria-label="All types">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {INVESTOR_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger className="w-[170px]" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-graphite-500">
          {formatCount(filtered.length)} shown
        </span>
        {active ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {filtered.length ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-line" role="table" aria-label="Investor directory">
          <div
            className="grid grid-cols-[minmax(0,1.6fr)_auto_1.2fr_1.6fr] items-center gap-5 bg-paper px-[22px] py-3 font-mono text-[11px] tracking-[0.05em] text-graphite-500 uppercase max-[820px]:hidden"
            role="row"
          >
            <span role="columnheader">Investor</span>
            <span role="columnheader" className="text-right">
              Portfolio
            </span>
            <span role="columnheader">Sectors</span>
            <span role="columnheader">Selected companies</span>
          </div>

          {filtered.map((inv) => (
            <div
              key={inv.name}
              className="grid grid-cols-[minmax(0,1.6fr)_auto_1.2fr_1.6fr] items-center gap-5 border-t border-line px-[22px] py-4 max-[820px]:grid-cols-1 max-[820px]:gap-y-2"
              role="row"
            >
              <span className="flex min-w-0 flex-col gap-1" role="cell">
                <span className="font-display text-base font-semibold tracking-tight text-ink">
                  {inv.name}
                </span>
                <Badge variant="pill" mono className="self-start">
                  {inv.type}
                </Badge>
              </span>
              <span
                className="text-right font-mono text-base font-medium text-ink max-[820px]:text-left"
                role="cell"
              >
                {formatCount(inv.portfolioCount)}
              </span>
              <span className="text-[13px] text-graphite-500" role="cell">
                {inv.sectors.length ? inv.sectors.join(' · ') : '—'}
              </span>
              <span className="truncate text-[13px] text-graphite-700" role="cell">
                {inv.companies.map((c) => c.name).join(', ')}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState className="mt-4">
          No investors match these filters. Try clearing the search or the type filter.
        </EmptyState>
      )}
    </div>
  );
}
