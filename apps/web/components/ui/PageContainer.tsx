import type { ComponentProps, ReactNode } from 'react';

import { cx } from './cx';
import styles from './PageContainer.module.css';

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
    <Tag className={cx(styles.container, className)} {...rest}>
      {children}
    </Tag>
  );
}
