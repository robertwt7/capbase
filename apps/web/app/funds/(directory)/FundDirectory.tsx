'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { FUND_STATUSES, FUND_STRATEGIES, type DirectoryPage, type FundSummary } from '@repo/api';

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
import { LockedFilter } from '@/components/LockedFilter';
import { isMasked, Masked, SignInChip, unlockOf } from '@/components/Masked';
import { formatCount, formatUsd } from '@/lib/format';

import { FUND_COLUMNS } from './columns';

const ALL = 'all';

type Sort = 'size' | 'vintage' | 'name';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'size', label: 'Fund size' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'name', label: 'Name' },
];

const isSort = (v: string | undefined): v is Sort =>
  v === 'size' || v === 'vintage' || v === 'name';

/**
 * Server-driven directory: filters/sort/page live in the URL, the server
 * component refetches one page from the API on every change. Same shape as
 * InvestorDirectory.
 */
export function FundDirectory({
  result,
  initial,
}: {
  /** `locked`: the filters and sorts the API ignores for this viewer (status,
   *  signed out, by default) — rendered as `LockedFilter`s / left out. */
  result: DirectoryPage<FundSummary>;
  initial: Record<string, string | undefined>;
}) {
  const { locked } = result;
  const sorts = SORTS.filter((s) => !locked.sorts.includes(s.value));
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [q, setQ] = useState(initial.q ?? '');
  const [strategy, setStrategy] = useState(initial.strategy ?? ALL);
  const [status, setStatus] = useState(initial.status ?? ALL);
  const [sort, setSort] = useState<Sort>(isSort(initial.sort) ? initial.sort : 'size');
  // Set by the investor profile's "all N funds" link. Not a control on this
  // page — it is cleared with the rest of the filters.
  const [manager, setManager] = useState(initial.manager ?? '');

  const filterQuery = (page?: number) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (strategy !== ALL) params.set('strategy', strategy);
    if (status !== ALL) params.set('status', status);
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
  }, [q, strategy, status, manager, sort, pathname, router]);

  const active =
    q.trim() !== '' || strategy !== ALL || status !== ALL || manager !== '' || sort !== 'size';
  const clear = () => {
    setQ('');
    setStrategy(ALL);
    setStatus(ALL);
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
        {!locked.filters.includes('strategy') && (
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
        )}
        {!locked.filters.includes('status') ? (
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[160px]" aria-label="Any status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any status</SelectItem>
              {FUND_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <LockedFilter entity="fund" param="status" unlockBy={locked.unlockBy.status} next="/funds" />
        )}
        {(['strategy'] as const)
          .filter((param) => locked.filters.includes(param))
          .map((param) => (
            <LockedFilter key={param} entity="fund" param={param} unlockBy={locked.unlockBy[param]} next="/funds" />
          ))}
        {/* A locked sort is left out; the API answers it in name order. */}
        <Select
          value={sorts.some((s) => s.value === sort) ? sort : (sorts[0]?.value ?? 'name')}
          onValueChange={(v) => setSort(v as Sort)}
        >
          <SelectTrigger className="w-[170px]" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sorts.map((s) => (
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
              className={`grid ${FUND_COLUMNS} items-center bg-paper px-[22px] py-3 font-mono text-[11px] tracking-[0.05em] text-graphite-500 uppercase max-[820px]:hidden`}
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
                className={`grid ${FUND_COLUMNS} items-center border-t border-line px-[22px] py-4 max-[820px]:gap-y-2`}
                role="row"
              >
                <span className="flex min-w-0 flex-col gap-0.5" role="cell">
                  {/* prefetch={false}: a profile prefetch renders its uncached
                      detail read, one API call per row in the viewport. */}
                  {fund.slug ? (
                    <Link
                      href={`/funds/${fund.slug}`}
                      prefetch={false}
                      className="font-display text-[15px] font-semibold tracking-tight text-ink underline-offset-[3px] transition-colors hover:text-graphite-700 hover:underline"
                    >
                      {fund.name}
                    </Link>
                  ) : (
                    <span className="font-display text-[15px] font-semibold tracking-tight text-ink">
                      {fund.name}
                    </span>
                  )}
                  {fund.status && (
                    <span className="font-mono text-[11px] tracking-[0.05em] text-graphite-500 uppercase">
                      {fund.status}
                    </span>
                  )}
                  {isMasked(fund, 'status') && (
                    <span className="self-start">
                      <SignInChip next="/funds" unlockBy={unlockOf(fund, 'status')} />
                    </span>
                  )}
                </span>
                <Link
                  href={`/investors/${fund.manager.slug}`}
                  prefetch={false}
                  className="max-w-full justify-self-start truncate text-[13px] text-graphite-700 underline-offset-[3px] transition-colors hover:text-ink hover:underline"
                  title={fund.manager.name}
                  role="cell"
                >
                  {fund.manager.name}
                </Link>
                <span role="cell">
                  {isMasked(fund, 'strategy') ? (
                    <SignInChip next="/funds" unlockBy={unlockOf(fund, 'strategy')} />
                  ) : fund.strategy ? (
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
                  <Masked entity={fund} field="vintageYear" next="/funds">
                    {fund.vintageYear ?? '—'}
                  </Masked>
                </span>
                {/* Gross assets is what Form ADV reports; a fund with none
                    renders "Undisclosed", never $0. */}
                <span
                  className="text-right font-mono text-base font-medium text-ink max-[820px]:text-left"
                  role="cell"
                >
                  {isMasked(fund, 'grossAssetsUsd') ||
                  (fund.grossAssetsUsd == null && isMasked(fund, 'closedUsd')) ? (
                    <SignInChip
                      next="/funds"
                      unlockBy={unlockOf(fund, isMasked(fund, 'grossAssetsUsd') ? 'grossAssetsUsd' : 'closedUsd')}
                    />
                  ) : (
                    formatUsd(fund.grossAssetsUsd ?? fund.closedUsd ?? null)
                  )}
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
          No funds match these filters. Try clearing the search, strategy or status filter.
        </EmptyState>
      )}
    </div>
  );
}
