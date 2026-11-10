'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import {
  COMPANY_STATUSES,
  SECTORS,
  STAGES,
  SCREEN_PARAMS,
  companyQueryToParams,
  hasRoundCriteria,
  type CompanyDirectoryPage,
  type CompanyListQuery,
  type CompanyScreenQuery,
  type CountryFacet,
} from '@repo/api';

import { CompanyTable } from '@/components/CompanyTable';
import { ALL_COUNTRIES, CountryFilter } from '@/components/CountryFilter';
import { LockedFilter } from '@/components/LockedFilter';
import {
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
import { companyColumnsParam, companyListQuery, type CompanyExtraColumn } from '@/lib/list-params';

import { ActiveFilters, screenChips, type Chip } from './ActiveFilters';
import { ScreenSheet } from './ScreenSheet';

const ALL = 'all';

type Sort = 'name' | 'raised' | 'valuation';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'raised', label: 'Total raised' },
  { value: 'valuation', label: 'Last valuation' },
];

/** The directory query minus the page (every change goes back to page 1). */
type Query = Omit<CompanyListQuery, 'page' | 'pageSize' | 'slugs' | 'domain'>;

const queryOf = (sp: Record<string, string | undefined>): Query => {
  const { page, pageSize, slugs, domain, ...q } = companyListQuery(sp);
  void [page, pageSize, slugs, domain];
  return q;
};

/** The canonical query string of a view: the shared param order, then `cols`, then `page`. */
function searchOf(query: Query, cols: readonly CompanyExtraColumn[], page?: number): string {
  const params = companyQueryToParams(query);
  if (cols.length) params.set('cols', cols.join(','));
  if (page && page > 1) params.set('page', String(page));
  return params.toString();
}

function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: readonly string[];
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className} aria-label={allLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Server-driven directory: filters, screening criteria, sort, columns and page
 * live in the URL; the server component refetches one page on every change and
 * this component renders it.
 *
 * Navigation: typing in the search box replaces the URL (debounced, no history
 * spam); every committed change — a select, the Filters sheet's Apply, a chip's
 * ×, "Clear filters" — pushes, so Back steps through filter states. Every
 * change drops `page`. When the URL changes from outside (Back/Forward, a
 * header-search deep link, a pagination link) the controls are reset from it.
 */
export function CompanyDirectory({
  result,
  countries,
  initial,
}: {
  /** `locked`: the filters and sorts the API ignores for this viewer; `screen`: what it applied. */
  result: CompanyDirectoryPage;
  countries: CountryFacet[];
  initial: Record<string, string | undefined>;
}) {
  const { locked, screen } = result;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const initialQuery = queryOf(initial);
  const initialCols = companyColumnsParam(initial.cols);
  const initialPage = companyListQuery(initial).page;
  const urlKey = searchOf(initialQuery, initialCols, initialPage);

  const [query, setQuery] = useState<Query>(initialQuery);
  const [qInput, setQInput] = useState(initialQuery.q ?? '');
  const [cols, setCols] = useState<CompanyExtraColumn[]>(initialCols);
  // When the URL changes, the controls follow it — unless this component wrote
  // that URL itself (the search box may already be ahead of it). `seen` is the
  // URL of the last render, `written` the URL the controls stand for. Adjusted
  // during render, not in an effect, so a Back press never paints stale controls.
  const [seen, setSeen] = useState(urlKey);
  const [written, setWritten] = useState(urlKey);
  if (urlKey !== seen) {
    setSeen(urlKey);
    if (urlKey !== written) {
      setWritten(urlKey);
      setQuery(initialQuery);
      setQInput(initialQuery.q ?? '');
      setCols(initialCols);
    }
  }

  const hrefOf = (q: Query, c: readonly CompanyExtraColumn[], page?: number) => {
    const qs = searchOf(q, c, page);
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const commit = (next: Query, nextCols: CompanyExtraColumn[] = cols, mode: 'push' | 'replace' = 'push') => {
    setQuery(next);
    setCols(nextCols);
    setWritten(searchOf(next, nextCols));
    const href = hrefOf(next, nextCols);
    startTransition(() => {
      router[mode](href, { scroll: false });
    });
  };

  // The search box: debounced, replacing (one history entry per search, not per key).
  useEffect(() => {
    const q = qInput.trim() || undefined;
    if (q === query.q) return;
    const t = setTimeout(() => commit({ ...query, q }, cols, 'replace'), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const set = (patch: Partial<Query>) => commit({ ...query, ...patch });
  const pick = (v: string) => (v === ALL ? undefined : v);

  /** The control, or — when the field it filters on is withheld — what opens it. */
  const filter = (param: string, control: React.ReactNode) =>
    locked.filters.includes(param) ? (
      <LockedFilter entity="company" param={param} unlockBy={locked.unlockBy[param]} next="/companies" />
    ) : (
      control
    );

  const sorts = SORTS.filter((s) => !locked.sorts.includes(s.value));
  const sort: Sort = query.sort ?? 'name';

  const chips = screenChips(query, screen, locked);
  const advanced = chips.filter((c) => !['q', 'sector', 'stage', 'status', 'country'].includes(c.key)).length;
  const active = chips.length > 0 || sort !== 'name' || SCREEN_PARAMS.some((p) => query[p] !== undefined);

  const removeChip = (chip: Chip) => {
    if (chip.key === 'q') setQInput('');
    commit({ ...query, ...chip.remove });
  };
  const clear = () => {
    setQInput('');
    // Columns are a view preference, not a filter: they stay.
    commit({}, cols);
  };

  const applyScreen = (next: CompanyScreenQuery, nextCols: CompanyExtraColumn[]) => {
    const base = Object.fromEntries(Object.entries(query).filter(([k]) => !(SCREEN_PARAMS as readonly string[]).includes(k)));
    commit({ ...base, ...next } as Query, nextCols);
  };

  // The Financing column whenever the financing filter (or an investor tied to
  // the matching financing) actually applied.
  const roundOff = locked.filters.includes('round') || locked.disabled.includes('round');
  const financing =
    screen !== null &&
    ((!roundOff && hasRoundCriteria(query)) || screen.investor?.scope === 'round');

  const { items, total, page, pageSize } = result;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const screenQuery: CompanyScreenQuery = Object.fromEntries(
    SCREEN_PARAMS.map((p) => [p, query[p]]).filter(([, v]) => v !== undefined),
  );

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search companies"
          aria-label="Search companies"
          className="h-11 max-w-xs flex-1 basis-56"
        />
        {filter(
          'sector',
          <FilterSelect
            value={query.sector ?? ALL}
            onChange={(v) => set({ sector: pick(v) as Query['sector'] })}
            allLabel="All sectors"
            options={SECTORS}
            className="w-[170px]"
          />,
        )}
        {filter(
          'stage',
          <FilterSelect
            value={query.stage ?? ALL}
            onChange={(v) => set({ stage: pick(v) as Query['stage'] })}
            allLabel="All stages"
            options={STAGES}
            className="w-[150px]"
          />,
        )}
        {filter(
          'status',
          <FilterSelect
            value={query.status ?? ALL}
            onChange={(v) => set({ status: pick(v) as Query['status'] })}
            allLabel="All statuses"
            options={COMPANY_STATUSES}
            className="w-[150px]"
          />,
        )}
        {filter(
          'country',
          <CountryFilter
            value={query.country ?? ALL_COUNTRIES}
            onChange={(v) => set({ country: v === ALL_COUNTRIES ? undefined : (v as Query['country']) })}
            countries={countries}
            className="w-[190px]"
          />,
        )}
        {/* A locked sort is left out; the API answers it in name order. */}
        <Select
          value={sorts.some((s) => s.value === sort) ? sort : 'name'}
          onValueChange={(v) => set({ sort: v === 'name' ? undefined : (v as Sort) })}
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
        <ScreenSheet
          // Reseeded from the query each time it opens.
          query={screenQuery}
          investorName={screen?.investor?.name ?? ''}
          locked={locked}
          count={advanced}
          columns={cols}
          onApply={applyScreen}
        />
      </div>

      <ActiveFilters chips={chips} onRemove={removeChip} onClear={clear} showClear={active} />

      <div className="mt-4 flex items-center justify-between gap-4">
        <span
          className="font-mono text-[11px] uppercase tracking-[0.08em] text-graphite-500"
          aria-live="polite"
        >
          {total === 0
            ? '0 matches'
            : `${formatCount(first)}–${formatCount(last)} of ${formatCount(total)}`}
        </span>
      </div>

      {items.length ? (
        <div className={`mt-4 transition-opacity ${isPending ? 'opacity-60' : ''}`}>
          <CompanyTable companies={items} columns={cols} matches={financing ? (screen?.matches ?? {}) : undefined} />
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            href={(p) => hrefOf(query, cols, p)}
            className="mt-6"
          />
        </div>
      ) : (
        <EmptyState className="mt-4">
          {screen?.investorNotFound
            ? 'No investor firm has that address. Pick one with the investor search in Filters.'
            : 'No companies match these filters. Try removing a filter or clearing them all.'}
        </EmptyState>
      )}
    </div>
  );
}
