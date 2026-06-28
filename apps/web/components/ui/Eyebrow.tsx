import type { ReactNode } from 'react';

import { cx } from './cx';
import styles from './Eyebrow.module.css';

export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx(styles.eyebrow, className)}>{children}</span>;
}
