import { COMPANY_COLUMNS } from '@/components/CompanyTable';
import { StatsSkeleton, TableSkeleton } from '@/components/skeletons';
import { LoadingStatus, PageContainer, SectionHeader, Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <PageContainer className="pt-14 pb-20" aria-busy="true">
      <LoadingStatus label="Loading sector…" />
      {/* Breadcrumb eyebrow, then the sector name. */}
      <span className="flex h-4 items-center">
        <Skeleton className="h-2.5 w-36" />
      </span>
      <span className="mt-3 flex h-9 items-center">
        <Skeleton className="h-7 w-56" />
      </span>

      <div className="mt-8 flex flex-wrap gap-x-14 gap-y-3 border-t border-b border-t-ink border-b-line py-7">
        <StatsSkeleton count={3} />
      </div>

      {/* The verticals list (a sector without verticals renders none). */}
      <div className="mt-10">
        <SectionHeader title="Verticals" note={<Skeleton className="h-3 w-20" />} />
        <div aria-hidden="true" className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="flex h-11 items-center justify-between rounded-sm border border-line bg-surface px-4">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-2.5 w-10" />
            </span>
          ))}
        </div>
      </div>

      <div className="mt-10">
        <SectionHeader title="Companies" note={<Skeleton className="h-3 w-24" />} />
        <div className="mt-6">
          <TableSkeleton cols={COMPANY_COLUMNS} cells={['left', 'right', 'right']} logo collapseAt={700} />
        </div>
      </div>
    </PageContainer>
  );
}
