import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

type ContainerTag = 'div' | 'main' | 'section' | 'header' | 'footer';

export function PageContainer({
  as: Tag = 'div',
  className,
  children,
  ...rest
}: {
  as?: ContainerTag;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<'div'>, 'className' | 'children'>) {
  return (
    <Tag className={cn('mx-auto w-full max-w-(--page-max) px-(--page-pad)', className)} {...rest}>
      {children}
    </Tag>
  );
}
