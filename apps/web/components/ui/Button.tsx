import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from './cx';
import styles from './Button.module.css';

type Variant = 'primary' | 'ghost' | 'outline';
type Shape = 'pill' | 'box';
type Size = 'sm' | 'md';

type CommonProps = {
  variant: Variant;
  shape?: Shape;
  size?: Size;
  block?: boolean;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<ComponentProps<'button'>, keyof CommonProps> & { href?: undefined };

type ButtonAsLink = CommonProps &
  Omit<ComponentProps<typeof Link>, keyof CommonProps | 'href'> & { href: string };

type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button({
  variant,
  shape = 'box',
  size = 'md',
  block,
  className,
  children,
  ...rest
}: ButtonProps) {
  const cls = cx(
    styles.button,
    styles[variant],
    // Ghost is chrome-less, so shape padding doesn't apply.
    variant !== 'ghost' && styles[shape],
    styles[size === 'sm' ? 'sizeSm' : 'sizeMd'],
    block && styles.block,
    className,
  );

  if (typeof rest.href === 'string') {
    return (
      <Link className={cls} {...(rest as ComponentProps<typeof Link>)}>
        {children}
      </Link>
    );
  }

  const { type, ...buttonProps } = rest as ComponentProps<'button'>;
  return (
    <button type={type ?? 'button'} className={cls} {...buttonProps}>
      {children}
    </button>
  );
}
