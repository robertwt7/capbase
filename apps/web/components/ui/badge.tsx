import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

// Monochrome meta tag. `variant` pill|box mirrors the old <Tag>; `mono` switches
// to the mono-uppercase terminal treatment used for status / type labels.
const badgeVariants = cva('inline-flex items-center border border-line text-graphite-700', {
  variants: {
    variant: {
      pill: 'rounded-full px-2.5 py-0.5',
      box: 'rounded-md px-2 py-0.5',
    },
    mono: {
      true: 'font-mono text-[11px] font-medium uppercase tracking-[0.08em]',
      false: 'font-sans text-xs',
    },
  },
  defaultVariants: { variant: 'box', mono: false },
});

function Badge({
  className,
  variant,
  mono,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant, mono }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
