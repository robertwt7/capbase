'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import {
  COMPANY_STATUSES,
  SECTORS,
  STAGES,
  type Company,
  type Paginated,
} from '@repo/api';

import { CompanyTable } from '@/components/CompanyTable';
import {
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

type Sort = 'name' | 'raised' | 'valuation';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'raised', label: 'Total raised' },
  { value: 'valuation', label: 'Last valuation' },
];

const isSort = (v: string | undefined): v is Sort =>
  v === 'name' || v === 'raised' || v === 'valuation';

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
 * Server-driven directory: filters/sort/page live in the URL, the server
 * component refetches one page from the API on every change. This component
 * only edits the URL (debounced) and renders the page it was given.
 */
export function CompanyDirectory({
  result,
  initial,
}: {
  result: Paginated<Company>;
  initial: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [q, setQ] = useState(initial.q ?? '');
  const [sector, setSector] = useState(initial.sector ?? ALL);
  const [stage, setStage] = useState(initial.stage ?? ALL);
  const [status, setStatus] = useState(initial.status ?? ALL);
  const [sort, setSort] = useState<Sort>(isSort(initial.sort) ? initial.sort : 'name');

  const filterQuery = (page?: number) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (sector !== ALL) params.set('sector', sector);
    if (stage !== ALL) params.set('stage', stage);
    if (status !== ALL) params.set('status', status);
    if (sort !== 'name') params.set('sort', sort);
    if (page && page > 1) params.set('page', String(page));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  // Mirror filter state to the URL (debounced) so views are shareable and the
  // header search can deep-link here; the server component refetches the page.
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
  }, [q, sector, stage, status, sort, pathname, router]);

  const active =
    q.trim() !== '' || sector !== ALL || stage !== ALL || status !== ALL || sort !== 'name';

  const clear = () => {
    setQ('');
    setSector(ALL);
    setStage(ALL);
    setStatus(ALL);
    setSort('name');
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
          placeholder="Search companies"
          aria-label="Search companies"
          className="h-11 max-w-xs flex-1 basis-56"
        />
        <FilterSelect
          value={sector}
          onChange={setSector}
          allLabel="All sectors"
          options={SECTORS}
          className="w-[170px]"
        />
        <FilterSelect
          value={stage}
          onChange={setStage}
          allLabel="All stages"
          options={STAGES}
          className="w-[150px]"
        />
        <FilterSelect
          value={status}
          onChange={setStatus}
          allLabel="All statuses"
          options={COMPANY_STATUSES}
          className="w-[150px]"
        />
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
          <CompanyTable companies={items} />
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
          No companies match these filters. Try clearing the search or a filter.
        </EmptyState>
      )}
    </div>
  );
}
