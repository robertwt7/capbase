import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function EmptyState({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 rounded-lg border border-dashed border-graphite-300 bg-paper px-5 py-6',
        className,
      )}
    >
      <p className="font-sans text-sm text-graphite-500">{children}</p>
      {action}
    </div>
  );
}
