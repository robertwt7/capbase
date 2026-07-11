import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Form-level (non-field) error box used by the RHF forms and the auth/admin pages. */
export function FormError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 font-sans text-sm text-destructive',
        className,
      )}
    >
      {children}
    </p>
  );
}
