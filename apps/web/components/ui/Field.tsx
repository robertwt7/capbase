import type { ComponentProps, ReactNode } from 'react';

import { cx } from './cx';
import styles from './Field.module.css';

/** Label + control wrapper. Render the control (Input/Textarea/Select) as children. */
export function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cx(styles.field, className)}>
      <span className={styles.label}>{label}</span>
      {children}
      {error ? <span className={styles.fieldError}>{error}</span> : null}
    </label>
  );
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx(styles.control, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx(styles.control, styles.textarea, className)} {...rest} />;
}

export function Select({ className, ...rest }: ComponentProps<'select'>) {
  return <select className={cx(styles.control, className)} {...rest} />;
}

export function FormError({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx(styles.error, className)}>{children}</p>;
}
