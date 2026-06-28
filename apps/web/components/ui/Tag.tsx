import type { ReactNode } from 'react';

import { cx } from './cx';
import styles from './Tag.module.css';

export function Tag({
  variant,
  mono = false,
  className,
  children,
}: {
  variant: 'pill' | 'box';
  mono?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cx(styles.tag, styles[variant], mono && styles.mono, className)}>
      {children}
    </span>
  );
}
