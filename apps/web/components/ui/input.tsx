import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';
import { controlClass } from './control';

export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn(controlClass, className)} {...props} />;
}
