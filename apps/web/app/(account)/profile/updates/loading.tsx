import { LoadingStatus, Skeleton } from '@/components/ui';
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-(--page-pad) pt-8 pb-20">
      <LoadingStatus label="Loading updates" />
      <Skeleton className="mb-8 h-10 w-48" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="my-4 h-24 w-full" />
      ))}
    </div>
  );
}
