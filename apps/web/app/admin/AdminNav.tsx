'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { PageContainer } from '../../components/ui';
import { cn } from '../../lib/utils';

export interface AdminNavCounts {
  queue: number;
  reports: number;
  merges: number;
}

/** The moderation sub-nav under the site header. The admin layout renders it for
 *  ADMIN sessions only; it wraps onto a second line rather than overflowing. */
export function AdminNav({ counts }: { counts: AdminNavCounts }) {
  const pathname = usePathname();
  const links = [
    { href: '/admin', label: 'Queue', count: counts.queue },
    { href: '/admin/reports', label: 'Reports', count: counts.reports },
    { href: '/admin/merges', label: 'Merges', count: counts.merges },
    { href: '/admin/users', label: 'Users', count: 0 },
  ];

  return (
    <div className="border-b border-line">
      <PageContainer className="flex flex-wrap items-center gap-x-6 gap-y-1 py-2">
        <span className="font-mono text-[11px] tracking-[0.14em] text-graphite-400 uppercase">
          Moderation
        </span>
        <nav aria-label="Moderation" className="flex flex-wrap gap-x-5 gap-y-1">
          {links.map(({ href, label, count }) => {
            // The queue is the segment root, so only an exact match is current.
            const current =
              href === '/admin' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'border-b-2 py-1.5 font-mono text-[11px] tracking-[0.06em] uppercase transition-colors hover:text-ink',
                  current ? 'border-ink font-medium text-ink' : 'border-transparent text-graphite-500',
                )}
              >
                {label}
                {count > 0 ? ` (${count})` : ''}
              </Link>
            );
          })}
        </nav>
      </PageContainer>
    </div>
  );
}
