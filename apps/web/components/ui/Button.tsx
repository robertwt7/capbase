import Link from 'next/link';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans font-medium ' +
    'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ' +
    'disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-paper hover:bg-graphite-900',
        outline: 'border border-ink text-ink hover:bg-ink hover:text-paper',
        ghost: 'text-ink hover:text-graphite-500',
      },
      shape: {
        pill: 'rounded-full',
        box: 'rounded-md',
      },
      size: {
        sm: 'h-9 text-sm',
        md: 'h-11 text-sm',
      },
      block: { true: 'w-full', false: '' },
    },
    compoundVariants: [
      // Ghost is chrome-less: no shape, no horizontal padding.
      { variant: 'ghost', class: 'h-auto px-0' },
      { variant: ['primary', 'outline'], size: 'sm', class: 'px-4' },
      { variant: ['primary', 'outline'], size: 'md', class: 'px-6' },
    ],
    defaultVariants: { variant: 'primary', shape: 'box', size: 'md', block: false },
  },
);

type Variant = NonNullable<VariantProps<typeof button>['variant']>;
type Shape = NonNullable<VariantProps<typeof button>['shape']>;
type Size = NonNullable<VariantProps<typeof button>['size']>;

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
  const cls = cn(button({ variant, shape, size, block: !!block }), className);

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
