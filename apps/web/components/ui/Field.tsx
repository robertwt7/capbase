import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Legacy label + control + error wrapper. Still used by the auth/admin pages.
    New forms use the react-hook-form <Form>/<FormField> primitives instead. */
export function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn('grid gap-1.5', className)}>
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-graphite-700">
        {label}
      </span>
      {children}
      {error ? <span className="font-sans text-[13px] font-semibold text-ink">{error}</span> : null}
    </label>
  );
}

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
