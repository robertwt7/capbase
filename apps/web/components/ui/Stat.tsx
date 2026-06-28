import type { ReactNode } from 'react';

import { cx } from './cx';
import styles from './Stat.module.css';

export function Stat({
  value,
  label,
  size = 'md',
  className,
}: {
  value: ReactNode;
  label: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <div className={cx(styles.stat, styles[size], className)}>
      <span className={styles.value}>{value}</span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
