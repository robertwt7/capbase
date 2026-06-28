'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] ' +
          'text-graphite-700 select-none group-data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
