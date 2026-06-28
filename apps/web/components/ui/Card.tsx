import type { ComponentProps, ReactNode } from 'react';

import { cx } from './cx';
import styles from './Card.module.css';

export function Card({
  emphasis = false,
  className,
  children,
  ...rest
}: {
  emphasis?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<'div'>, 'className' | 'children'>) {
  return (
    <div className={cx(styles.card, emphasis && styles.emphasis, className)} {...rest}>
      {children}
    </div>
  );
}
