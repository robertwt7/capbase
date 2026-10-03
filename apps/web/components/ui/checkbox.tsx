'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { CheckIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/** shadcn Checkbox (new-york), re-themed onto the ledger: a `surface` box with a
    hairline border, filled with ink when checked, and the shared red invalid
    treatment — the one sanctioned use of red. */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-4 shrink-0 rounded-[4px] border border-input bg-surface transition-colors outline-none',
        'focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/15',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/15',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
