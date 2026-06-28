import type { ReactNode } from 'react';

import { cx } from './cx';
import styles from './EmptyState.module.css';

export function EmptyState({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx(styles.empty, className)}>
      <p className={styles.text}>{children}</p>
      {action}
    </div>
  );
}
