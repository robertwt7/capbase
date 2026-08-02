'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { INVESTOR_TYPES, type InvestorSummary, type Paginated } from '@repo/api';

import {
  Badge,
  Button,
  EmptyState,
  Input,
  Pagination,
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

/**
 * Server-driven directory: filters/sort/page live in the URL, the server
 * component refetches one page from the API on every change.
 */
export function InvestorDirectory({
  result,
  initial,
}: {
  result: Paginated<InvestorSummary>;
  initial: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [q, setQ] = useState(initial.q ?? '');
  const [type, setType] = useState(initial.type ?? ALL);
  const [sort, setSort] = useState<Sort>(isSort(initial.sort) ? initial.sort : 'portfolio');

  const filterQuery = (page?: number) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (type !== ALL) params.set('type', type);
    if (sort !== 'portfolio') params.set('sort', sort);
    if (page && page > 1) params.set('page', String(page));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  // Mirror filter state to the URL (debounced); the server component refetches.
  // Any filter change drops the page param (back to page 1). Skipped on mount
  // so a deep-linked ?page=N isn't stripped before the user touches a filter.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const next = filterQuery();
    const t = setTimeout(() => {
      startTransition(() => {
        router.replace(next, { scroll: false });
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, sort, pathname, router]);

  const active = q.trim() !== '' || type !== ALL || sort !== 'portfolio';
  const clear = () => {
    setQ('');
    setType(ALL);
    setSort('portfolio');
  };

  const { items, total, page, pageSize } = result;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

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
          {total === 0
            ? '0 matches'
            : `${formatCount(first)}–${formatCount(last)} of ${formatCount(total)}`}
        </span>
        {active ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {items.length ? (
        <div className={`mt-4 transition-opacity ${isPending ? 'opacity-60' : ''}`}>
          <div className="overflow-hidden rounded-xl border border-line bg-surface" role="table" aria-label="Investor directory">
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

            {items.map((inv) => (
              <Link
                key={inv.slug || inv.name}
                href={`/investors/${inv.slug}`}
                className="grid grid-cols-[minmax(0,1.6fr)_auto_1.2fr_1.6fr] items-center gap-5 border-t border-line px-[22px] py-4 transition-colors hover:bg-paper max-[820px]:grid-cols-1 max-[820px]:gap-y-2"
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
                {/* Most firms in the SEC Form ADV universe have no disclosed
                    portfolio — say so plainly and invite a contribution. */}
                <span className="truncate text-[13px] text-graphite-700" role="cell">
                  {inv.companies.length ? (
                    inv.companies.map((c) => c.name).join(', ')
                  ) : (
                    <span className="text-graphite-500">No known investments yet →</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            href={(p) => filterQuery(p)}
            className="mt-6"
          />
        </div>
      ) : (
        <EmptyState className="mt-4">
          No investors match these filters. Try clearing the search or the type filter.
        </EmptyState>
      )}
    </div>
  );
}
