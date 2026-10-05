import type { ReactNode } from 'react';

import { LoadingStatus, PageContainer, SectionHeader, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

/** Alignment of each column after the first: numbers sit right, as in the real tables. */
export type CellAlign = 'left' | 'right';

/** The real tables hide their header strip where the grid collapses to one column. */
const HIDE_HEADER = {
  700: 'max-[700px]:hidden',
  820: 'max-[820px]:hidden',
} as const;

// Cycled per row so a column of placeholders doesn't read as one solid slab.
const NAME_WIDTHS = ['w-2/5', 'w-1/2', 'w-1/3', 'w-[45%]', 'w-2/5', 'w-[30%]'] as const;
const SUB_WIDTHS = ['w-1/4', 'w-1/3', 'w-1/5', 'w-[30%]', 'w-1/4', 'w-1/3'] as const;

/**
 * The directory table shell — same border, surface and padding as the real
 * tables — with placeholder rows. `cols` is the real table's grid string
 * (template + gaps), imported from the component, so column edges line up
 * with the rows that replace it.
 */
export function TableSkeleton({
  cols,
  cells,
  rows = 10,
  lines = 2,
  logo = false,
  collapseAt,
}: {
  cols: string;
  /** Alignment of every column after the first (which holds the name). */
  cells: readonly CellAlign[];
  rows?: number;
  /** Text lines in the name cell: a name alone, or a name over a sub-line. */
  lines?: 1 | 2;
  logo?: boolean;
  collapseAt?: keyof typeof HIDE_HEADER;
}) {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-xl border border-line bg-surface">
      <div
        className={cn(
          'grid items-center bg-paper px-[22px] py-3',
          cols,
          collapseAt && HIDE_HEADER[collapseAt],
        )}
      >
        <span className="flex h-4 items-center">
          <Skeleton className="h-2.5 w-16" />
        </span>
        {cells.map((align, i) => (
          <span key={i} className={cn('flex h-4 items-center', align === 'right' && 'justify-end')}>
            <Skeleton className="h-2.5 w-14" />
          </span>
        ))}
      </div>

      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={cn('grid items-center border-t border-line px-[22px] py-4', cols)}>
          <span className="flex min-w-0 items-center gap-3.5">
            {logo ? <Skeleton className="size-10 shrink-0 rounded-sm" /> : null}
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className={cn('h-4', NAME_WIDTHS[r % NAME_WIDTHS.length])} />
              {lines === 2 ? (
                <Skeleton className={cn('h-3', SUB_WIDTHS[r % SUB_WIDTHS.length])} />
              ) : null}
            </span>
          </span>
          {cells.map((align, i) => (
            <span key={i} className={cn('flex', align === 'right' && 'justify-end')}>
              <Skeleton className="h-3.5 w-16" />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The directory filter bar: the search box, then one block per control. Each
 * entry in `controls` is the control's own size classes (a select is
 * `w-[170px]`; a pill button overrides the height and radius too).
 */
export function FilterBarSkeleton({ controls }: { controls: readonly string[] }) {
  return (
    <div aria-hidden="true">
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Skeleton className="h-11 max-w-xs flex-1 basis-56 rounded-md" />
        {controls.map((cls, i) => (
          <Skeleton key={i} className={cn('h-11 w-[190px] rounded-md', cls)} />
        ))}
      </div>
      <div className="mt-4 flex h-4 items-center">
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  );
}

/** A loading directory page: the real header, then the filter bar and table placeholders. */
export function DirectorySkeleton({
  title,
  label,
  controls,
  cols,
  cells,
  lines,
  logo,
  collapseAt,
}: {
  title: string;
  /** Plural noun for the status announcement: "Loading {label}…". */
  label: string;
  controls: readonly string[];
  cols: string;
  cells: readonly CellAlign[];
  lines?: 1 | 2;
  logo?: boolean;
  collapseAt?: keyof typeof HIDE_HEADER;
}) {
  return (
    <PageContainer className="pt-14 pb-20" aria-busy="true">
      <LoadingStatus label={`Loading ${label}…`} />
      <SectionHeader title={title} note={<Skeleton className="h-3 w-20" />} />
      <FilterBarSkeleton controls={controls} />
      <div className="mt-4">
        <TableSkeleton
          cols={cols}
          cells={cells}
          lines={lines}
          logo={logo}
          collapseAt={collapseAt}
        />
      </div>
    </PageContainer>
  );
}

/** `Stat`-shaped placeholders: a mono figure over its label, each bar sitting
    in a slot of the real line height so the strip keeps its height. */
export function StatsSkeleton({
  count,
  size = 'lg',
}: {
  count: number;
  size?: 'md' | 'lg';
}): ReactNode {
  return Array.from({ length: count }, (_, i) => (
    <span key={i} aria-hidden="true" className="flex flex-col gap-1">
      <span className={cn('flex items-center', size === 'lg' ? 'h-9' : 'h-7')}>
        <Skeleton className={size === 'lg' ? 'h-7 w-24' : 'h-5 w-20'} />
      </span>
      <span className="flex h-4 items-center">
        <Skeleton className="h-2.5 w-16" />
      </span>
    </span>
  ));
}

const PROFILES = {
  company: { logo: true, actions: 3, facts: 8, stats: 4, sections: 3 },
  investor: { logo: true, actions: 0, facts: 4, stats: 3, sections: 3 },
  person: { logo: false, actions: 0, facts: 0, stats: 3, sections: 1 },
} as const;

/**
 * A loading profile page, mirroring the real ones' geometry: the back link
 * (and the company's action pills), the header — logo, name, one-liner, badges
 * and fact grid — the stat strip, then a few sections of panel rows. A person
 * has no logo or fact grid; their metrics sit inside the header.
 */
export function ProfileSkeleton({
  variant,
  label,
}: {
  variant: keyof typeof PROFILES;
  /** Announced as "Loading {label}…". */
  label: string;
}) {
  const p = PROFILES[variant];
  const title = (
    <span className="flex h-[clamp(1.875rem,4vw,2.75rem)] items-center">
      <Skeleton className="h-4/5 w-72 max-w-full" />
    </span>
  );

  return (
    <div className="mx-auto max-w-(--page-max) px-(--page-pad) pt-8 pb-16" aria-busy="true">
      <LoadingStatus label={`Loading ${label}…`} />

      <div aria-hidden="true" className="flex min-h-9 items-center justify-between gap-4">
        <Skeleton className="h-3 w-28" />
        {p.actions > 0 ? (
          <div className="flex items-center gap-2.5">
            {Array.from({ length: p.actions }, (_, i) => (
              <Skeleton key={i} className="h-9 w-20 rounded-full" />
            ))}
          </div>
        ) : null}
      </div>

      {p.logo ? (
        <header
          aria-hidden="true"
          className="grid grid-cols-[auto_1fr_auto] items-start gap-7 border-b border-ink pt-7 pb-9 max-[860px]:grid-cols-[auto_1fr] max-[600px]:grid-cols-1"
        >
          <Skeleton className="size-[72px] rounded-md" />
          <div className="min-w-0">
            {title}
            <span className="mt-3 flex h-[25px] items-center">
              <Skeleton className="h-4 w-[40ch] max-w-full" />
            </span>
            <div className="mt-4 flex flex-wrap gap-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
          </div>
          <div className="grid grid-cols-[repeat(2,auto)] gap-x-8 gap-y-4 max-[860px]:col-span-full max-[860px]:grid-cols-[repeat(4,auto)] max-[860px]:justify-start max-[600px]:grid-cols-[repeat(2,auto)]">
            {Array.from({ length: p.facts }, (_, i) => (
              <span key={i} className="flex flex-col gap-2 py-0.5">
                <Skeleton className="h-2.5 w-14" />
                <Skeleton className="h-3.5 w-20" />
              </span>
            ))}
          </div>
        </header>
      ) : (
        <header aria-hidden="true" className="border-b border-ink pt-7 pb-9">
          {title}
          <div className="mt-5 flex flex-wrap gap-x-16 gap-y-3.5">
            <StatsSkeleton count={p.stats} size="md" />
          </div>
        </header>
      )}

      {p.logo ? (
        <div aria-hidden="true" className="flex flex-wrap gap-x-16 gap-y-3.5 border-b border-line py-8">
          <StatsSkeleton count={p.stats} size="md" />
        </div>
      ) : null}

      {Array.from({ length: p.sections }, (_, s) => (
        <div
          key={s}
          aria-hidden="true"
          // The first section under a stat strip has no rule of its own (the
          // strip's border-b is it); a person's sits straight under the header.
          className={cn('py-8', (s > 0 || !p.logo) && 'border-t border-line')}
        >
          <span className="flex h-7 items-center">
            <Skeleton className="h-5 w-40" />
          </span>
          <div className="mt-5 overflow-hidden rounded-[10px] border border-line bg-surface">
            {Array.from({ length: 3 }, (_, r) => (
              <div key={r} className="flex flex-col gap-2 border-t border-line px-[18px] py-4 first:border-t-0">
                <Skeleton className={cn('h-4', NAME_WIDTHS[(r + s) % NAME_WIDTHS.length])} />
                <Skeleton className={cn('h-3', SUB_WIDTHS[(r + s) % SUB_WIDTHS.length])} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
