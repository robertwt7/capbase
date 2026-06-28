import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';
import { controlClass } from './control';

/** Native, monochrome-styled <select>. Native keeps it trivial to register with
    react-hook-form (no Controller needed) and fully accessible by default. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        controlClass,
        "appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9 " +
          "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%230e0e10' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    />
  );
}
