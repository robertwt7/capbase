import { SECTORS } from '@repo/api';

import { StatsSkeleton, TableSkeleton } from '@/components/skeletons';
import { LoadingStatus, PageContainer, SectionHeader, Skeleton } from '@/components/ui';

import { MARKET_COLUMNS } from '../columns';

export default function Loading() {
  return (
    <PageContainer className="pt-14 pb-20" aria-busy="true">
      <LoadingStatus label="Loading markets…" />
      <SectionHeader title="Markets" note={<Skeleton className="h-3 w-16" />} />

      <div className="mt-6 flex flex-wrap gap-x-14 gap-y-3 border-t border-b border-t-ink border-b-line py-7">
        <StatsSkeleton count={3} />
      </div>

      <div className="mt-10">
        <TableSkeleton
          cols={MARKET_COLUMNS}
          cells={['right', 'right', 'right', 'right', 'right']}
          rows={SECTORS.length}
          lines={1}
        />
      </div>
    </PageContainer>
  );
}
