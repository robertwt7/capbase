import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/** A pulsing placeholder block. A <span> (display:block) so it is valid inside
    phrasing content such as SectionHeader's note. Decorative: hidden from AT —
    each loading view carries one <LoadingStatus> instead. `motion-safe:` because
    globals.css shortens (not removes) animations under reduced motion, which
    would make an infinite pulse flicker. */
export function Skeleton({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded-sm bg-graphite-200 motion-safe:animate-pulse', className)}
      {...props}
    />
  );
}

/** The one screen-reader announcement for a loading view. */
export function LoadingStatus({ label }: { label: string }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}
