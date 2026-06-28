import type { ReactNode } from 'react';

import { cx } from './cx';
import styles from './SectionHeader.module.css';

type HeadingLevel = 'h1' | 'h2' | 'h3';

export function SectionHeader({
  title,
  note,
  size = 'lg',
  as: Heading = 'h2',
  className,
}: {
  title: ReactNode;
  note?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  as?: HeadingLevel;
  className?: string;
}) {
  return (
    <div className={cx(styles.head, className)}>
      <Heading className={cx(styles.title, styles[size])}>{title}</Heading>
      {note ? <span className={styles.note}>{note}</span> : null}
    </div>
  );
}
