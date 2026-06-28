import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Tag({
  variant,
  mono = false,
  className,
  children,
}: {
  variant: 'pill' | 'box';
  mono?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center border border-line text-graphite-700',
        variant === 'pill' ? 'rounded-full px-2.5 py-0.5' : 'rounded-md px-2 py-0.5',
        mono
          ? 'font-mono text-[11px] font-medium uppercase tracking-[0.08em]'
          : 'font-sans text-xs',
        className,
      )}
    >
      {children}
    </span>
  );
}
