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

      <div className="mt-10">
        <SectionHeader title="Companies" note={<Skeleton className="h-3 w-24" />} />
        <div className="mt-6">
          <TableSkeleton cols={COMPANY_COLUMNS} cells={['left', 'right', 'right']} logo collapseAt={700} />
        </div>
      </div>
    </PageContainer>
  );
}
