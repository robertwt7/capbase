import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Stat({
  value,
  label,
  size = 'md',
  className,
}: {
  value: ReactNode;
  label: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span
        className={cn(
          'font-mono font-medium tabular-nums tracking-tight text-ink',
          size === 'lg' ? 'text-3xl' : 'text-xl',
        )}
      >
        {value}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-graphite-500">
        {label}
      </span>
    </div>
  );
}
