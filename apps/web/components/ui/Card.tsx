import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Card({
  emphasis = false,
  className,
  children,
  ...rest
}: {
  emphasis?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<'div'>, 'className' | 'children'>) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-surface',
        emphasis ? 'border-ink' : 'border-line',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
