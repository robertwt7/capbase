import Link from 'next/link';

/** A status/type filter pill for the admin queues; the active one is filled. */
export function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        'rounded-full border px-3.5 py-1.5 font-mono text-[11px] tracking-[0.06em] uppercase transition-colors ' +
        (active
          ? 'border-ink bg-primary text-primary-foreground'
          : 'border-line bg-surface text-graphite-700 hover:border-ink hover:text-ink')
      }
    >
      {children}
    </Link>
  );
}
