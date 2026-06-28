import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Form-level (non-field) error box used by the RHF forms and the auth/admin pages. */
export function FormError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'rounded-md border border-line bg-surface px-3 py-2.5 font-sans text-sm text-ink',
        className,
      )}
    >
      {children}
    </p>
  );
}
