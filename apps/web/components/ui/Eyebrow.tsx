import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-graphite-500',
        className,
      )}
    >
      {children}
    </span>
  );
}
