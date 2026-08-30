'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { FUND_STRATEGIES, type FundSummary, type Paginated } from '@repo/api';

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
import { formatCount, formatUsd } from '@/lib/format';

const ALL = 'all';

type Sort = 'size' | 'vintage' | 'name';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'size', label: 'Fund size' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'name', label: 'Name' },
];

const isSort = (v: string | undefined): v is Sort =>
  v === 'size' || v === 'vintage' || v === 'name';

const COLUMNS =
  'grid-cols-[minmax(0,1.7fr)_minmax(0,1.1fr)_auto_auto_auto] max-[820px]:grid-cols-1';

/**
 * Server-driven directory: filters/sort/page live in the URL, the server
 * component refetches one page from the API on every change. Same shape as
 * InvestorDirectory.
 */
export function FundDirectory({
  result,
  initial,
}: {
  result: Paginated<FundSummary>;
  initial: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [q, setQ] = useState(initial.q ?? '');
  const [strategy, setStrategy] = useState(initial.strategy ?? ALL);
  const [sort, setSort] = useState<Sort>(isSort(initial.sort) ? initial.sort : 'size');
  // Set by the investor profile's "all N funds" link. Not a control on this
  // page — it is cleared with the rest of the filters.
  const [manager, setManager] = useState(initial.manager ?? '');

  const filterQuery = (page?: number) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (strategy !== ALL) params.set('strategy', strategy);
    if (manager) params.set('manager', manager);
    if (sort !== 'size') params.set('sort', sort);
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
  }, [q, strategy, manager, sort, pathname, router]);

  const active = q.trim() !== '' || strategy !== ALL || manager !== '' || sort !== 'size';
  const clear = () => {
    setQ('');
    setStrategy(ALL);
    setManager('');
    setSort('size');
  };

  const { items, total, page, pageSize } = result;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const managerName = manager ? (items[0]?.manager.name ?? manager) : null;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search funds"
          aria-label="Search funds"
          className="h-11 max-w-xs flex-1 basis-56"
        />
        <Select value={strategy} onValueChange={setStrategy}>
          <SelectTrigger className="w-[190px]" aria-label="All strategies">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All strategies</SelectItem>
            {FUND_STRATEGIES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
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
        {managerName ? (
          <Badge variant="pill" mono className="self-center">
            Manager: {managerName}
          </Badge>
        ) : null}
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
          <div
            className="overflow-hidden rounded-xl border border-line bg-surface"
            role="table"
            aria-label="Fund directory"
          >
            <div
              className={`grid ${COLUMNS} items-center gap-5 bg-paper px-[22px] py-3 font-mono text-[11px] tracking-[0.05em] text-graphite-500 uppercase max-[820px]:hidden`}
              role="row"
            >
              <span role="columnheader">Fund</span>
              <span role="columnheader">Manager</span>
              <span role="columnheader">Strategy</span>
              <span role="columnheader" className="text-right">
                Vintage
              </span>
              <span role="columnheader" className="text-right">
                Size
              </span>
            </div>

            {items.map((fund) => (
              <div
                key={fund.id}
                className={`grid ${COLUMNS} items-center gap-5 border-t border-line px-[22px] py-4 max-[820px]:gap-y-2`}
                role="row"
              >
                <span className="min-w-0 font-display text-[15px] font-semibold tracking-tight text-ink" role="cell">
                  {fund.name}
                </span>
                <Link
                  href={`/investors/${fund.manager.slug}`}
                  className="truncate text-[13px] text-graphite-700 underline-offset-[3px] transition-colors hover:text-ink hover:underline"
                  role="cell"
                >
                  {fund.manager.name}
                </Link>
                <span role="cell">
                  {fund.strategy ? (
                    <Badge variant="pill" mono>
                      {fund.strategy}
                    </Badge>
                  ) : (
                    <span className="text-[13px] text-graphite-500">—</span>
                  )}
                </span>
                <span
                  className="text-right font-mono text-sm text-ink max-[820px]:text-left"
                  role="cell"
                >
                  {fund.vintageYear ?? '—'}
                </span>
                {/* Gross assets is what Form ADV reports; a fund with none
                    renders "Undisclosed", never $0. */}
                <span
                  className="text-right font-mono text-base font-medium text-ink max-[820px]:text-left"
                  role="cell"
                >
                  {formatUsd(fund.grossAssetsUsd ?? fund.closedUsd ?? null)}
                </span>
              </div>
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
          No funds match these filters. Try clearing the search or the strategy filter.
        </EmptyState>
      )}
    </div>
  );
}
