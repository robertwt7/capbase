import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';
import { controlClass } from './control';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(controlClass, 'min-h-24 resize-y', className)}
      {...props}
    />
  );
}
