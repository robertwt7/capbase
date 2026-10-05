import { LoadingStatus, SectionHeader, Skeleton } from '@/components/ui';

/** The history page's own boundary: deeper than (profile), so profile → History
    shows this, never the profile skeleton. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-(--page-max) px-(--page-pad) pt-8 pb-16" aria-busy="true">
      <LoadingStatus label="Loading change history…" />
      <span className="flex h-5 items-center">
        <Skeleton className="h-3 w-32" />
      </span>

      <header className="border-b border-ink pt-6 pb-7">
        <h1 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-none font-extrabold tracking-[-0.03em] text-ink">
          Change history
        </h1>
        <span aria-hidden="true" className="mt-3 flex max-w-[60ch] flex-col gap-2.5 py-1">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/4" />
        </span>
      </header>

      <section className="pt-8">
        <SectionHeader
          title="Timeline"
          note={<Skeleton className="h-3 w-20" />}
          size="md"
          className="mb-5"
        />
        <ol aria-hidden="true" className="flex flex-col">
          {Array.from({ length: 8 }, (_, i) => (
            <li
              key={i}
              className="grid grid-cols-[170px_1fr] items-start gap-x-6 border-t border-line py-4 max-md:grid-cols-1 max-md:gap-y-2"
            >
              <span className="flex flex-col gap-2">
                <Skeleton className="h-2.5 w-28" />
                <Skeleton className="h-2.5 w-20" />
              </span>
              <span className="flex flex-col gap-2">
                <Skeleton className={i % 2 ? 'h-4 w-1/3' : 'h-4 w-2/5'} />
                <Skeleton className={i % 3 ? 'h-3 w-1/4' : 'h-3 w-1/3'} />
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
