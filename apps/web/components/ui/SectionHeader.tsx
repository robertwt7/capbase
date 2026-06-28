import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type HeadingLevel = 'h1' | 'h2' | 'h3';

const sizes = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
} as const;

export function SectionHeader({
  title,
  note,
  size = 'lg',
  as: Heading = 'h2',
  className,
}: {
  title: ReactNode;
  note?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  as?: HeadingLevel;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 border-b border-line pb-3', className)}>
      <Heading className={cn('font-display font-semibold tracking-tight text-ink', sizes[size])}>
        {title}
      </Heading>
      {note ? (
        <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-graphite-500">
          {note}
        </span>
      ) : null}
    </div>
  );
}
