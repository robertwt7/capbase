'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { COMPANY_STATUSES, SECTORS, STAGES } from '@repo/api';

import { CompanyTable } from '@/components/CompanyTable';
import {
  Button,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import type { Company } from '@/lib/data';
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

export function CompanyDirectory({
  companies,
  initial,
}: {
  companies: Company[];
  initial: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [q, setQ] = useState(initial.q ?? '');
  const [sector, setSector] = useState(initial.sector ?? ALL);
  const [stage, setStage] = useState(initial.stage ?? ALL);
  const [status, setStatus] = useState(initial.status ?? ALL);
  const [sort, setSort] = useState<Sort>(isSort(initial.sort) ? initial.sort : 'name');

  // Mirror filter state to the URL (debounced) so views are shareable and the
  // header search can deep-link here. Empty / "all" keys are dropped.
  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (sector !== ALL) params.set('sector', sector);
    if (stage !== ALL) params.set('stage', stage);
    if (status !== ALL) params.set('status', status);
    if (sort !== 'name') params.set('sort', sort);
    const query = params.toString();
    const t = setTimeout(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [q, sector, stage, status, sort, pathname, router]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = companies.filter((c) => {
      if (
        needle &&
        !c.name.toLowerCase().includes(needle) &&
        !c.oneLiner.toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (sector !== ALL && c.primarySector !== sector) return false;
      if (stage !== ALL && c.stage !== stage) return false;
      if (status !== ALL && c.status !== status) return false;
      return true;
    });
    const sorted = [...list];
    if (sort === 'raised') sorted.sort((a, b) => b.totalRaisedUsd - a.totalRaisedUsd);
    else if (sort === 'valuation')
      sorted.sort((a, b) => (b.lastValuationUsd ?? 0) - (a.lastValuationUsd ?? 0));
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [companies, q, sector, stage, status, sort]);

  const active =
    q.trim() !== '' || sector !== ALL || stage !== ALL || status !== ALL || sort !== 'name';

  const clear = () => {
    setQ('');
    setSector(ALL);
    setStage(ALL);
    setStatus(ALL);
    setSort('name');
  };

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
          {formatCount(filtered.length)} shown
        </span>
        {active ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {filtered.length ? (
        <div className="mt-4">
          <CompanyTable companies={filtered} />
        </div>
      ) : (
        <EmptyState className="mt-4">
          No companies match these filters. Try clearing the search or a filter.
        </EmptyState>
      )}
    </div>
  );
}
