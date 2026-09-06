'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import type { Paginated, PersonSummary } from '@repo/api';

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

type Sort = 'roles' | 'name';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'roles', label: 'Roles held' },
  { value: 'name', label: 'Name' },
];

const isSort = (v: string | undefined): v is Sort => v === 'roles' || v === 'name';

/** The organisations on a person's row: companies and firms alike, deduped. */
function organisations(person: PersonSummary): string[] {
  const names = person.roles.map((r) => r.company?.name ?? r.investor?.name).filter(Boolean);
  return [...new Set(names as string[])];
}

/**
 * Server-driven directory: filters/sort/page live in the URL, the server
 * component refetches one page from the API on every change.
 *
 * There is deliberately **no role filter**. The corpus holds thousands of
 * distinct free-text role strings — a Form C signature block is prose — so
 * offering them as a vocabulary would be a lie about the data.
 */
export function PeopleDirectory({
  result,
  initial,
}: {
  result: Paginated<PersonSummary>;
  initial: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [q, setQ] = useState(initial.q ?? '');
  const [multiCompany, setMultiCompany] = useState(initial.multiCompany === 'true');
  const [sort, setSort] = useState<Sort>(isSort(initial.sort) ? initial.sort : 'roles');

  const filterQuery = (page?: number) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (multiCompany) params.set('multiCompany', 'true');
    if (sort !== 'roles') params.set('sort', sort);
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
  }, [q, multiCompany, sort, pathname, router]);

  const active = q.trim() !== '' || multiCompany || sort !== 'roles';
  const clear = () => {
    setQ('');
    setMultiCompany(false);
    setSort('roles');
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
          placeholder="Search people"
          aria-label="Search people"
          className="h-11 max-w-xs flex-1 basis-56"
        />
        <Button
          variant={multiCompany ? 'primary' : 'outline'}
          shape="pill"
          size="sm"
          aria-pressed={multiCompany}
          onClick={() => setMultiCompany((v) => !v)}
        >
          At several companies
        </Button>
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
        <span className="font-mono text-[11px] tracking-[0.08em] text-graphite-500 uppercase">
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
            aria-label="People directory"
          >
            <div
              className="grid grid-cols-[minmax(0,1.4fr)_auto_auto_minmax(0,2fr)] items-center gap-5 bg-paper px-[22px] py-3 font-mono text-[11px] tracking-[0.05em] text-graphite-500 uppercase max-[820px]:hidden"
              role="row"
            >
              <span role="columnheader">Person</span>
              <span role="columnheader" className="text-right">
                Roles
              </span>
              <span role="columnheader" className="text-right">
                Companies
              </span>
              <span role="columnheader">Seen at</span>
            </div>

            {items.map((person) => {
              const orgs = organisations(person);
              return (
                <Link
                  key={person.slug}
                  href={`/people/${person.slug}`}
                  className="grid grid-cols-[minmax(0,1.4fr)_auto_auto_minmax(0,2fr)] items-center gap-5 border-t border-line px-[22px] py-4 transition-colors hover:bg-paper max-[820px]:grid-cols-1 max-[820px]:gap-y-2"
                  role="row"
                >
                  <span className="min-w-0 truncate" role="cell">
                    <span className="font-display text-base font-semibold tracking-tight text-ink">
                      {person.name}
                    </span>
                  </span>
                  <span
                    className="text-right font-mono text-base font-medium text-ink max-[820px]:text-left"
                    role="cell"
                  >
                    {formatCount(person.roleCount)}
                  </span>
                  <span
                    className="text-right font-mono text-base text-graphite-700 max-[820px]:text-left"
                    role="cell"
                  >
                    {formatCount(person.companyCount)}
                  </span>
                  <span className="truncate text-[13px] text-graphite-700" role="cell">
                    {orgs.length ? orgs.join(', ') : <span className="text-graphite-500">—</span>}
                  </span>
                </Link>
              );
            })}
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
          No people match these filters. Try clearing the search.
        </EmptyState>
      )}
    </div>
  );
}
