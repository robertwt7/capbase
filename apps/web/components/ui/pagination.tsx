import { Button } from './button';
import { cn } from '@/lib/utils';

/** Windowed page list: first, last, ±2 around current, with null gaps. */
export function pageWindow(current: number, totalPages: number): (number | null)[] {
  const pages = new Set<number>([1, totalPages]);
  for (let p = current - 2; p <= current + 2; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * Numbered pagination over URL search params. Each page is a real link that
 * preserves the current filters, so paged views stay shareable and the server
 * component refetches on navigation.
 */
export function Pagination({
  page,
  pageSize,
  total,
  href,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Builds the target URL for a page (current filters preserved by the caller). */
  href: (page: number) => string;
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const current = Math.min(Math.max(1, page), totalPages);

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex flex-wrap items-center justify-center gap-1.5', className)}
    >
      {current > 1 ? (
        <Button variant="outline" shape="box" size="sm" href={href(current - 1)}>
          ← Prev
        </Button>
      ) : null}

      {pageWindow(current, totalPages).map((p, i) =>
        p === null ? (
          <span
            key={`gap-${i}`}
            aria-hidden="true"
            className="px-1 font-mono text-sm text-graphite-400"
          >
            …
          </span>
        ) : p === current ? (
          <Button
            key={p}
            variant="outline"
            shape="box"
            size="sm"
            href={href(p)}
            aria-current="page"
            className="min-w-9 border-ink font-mono"
          >
            {p}
          </Button>
        ) : (
          <Button
            key={p}
            variant="ghost"
            size="sm"
            href={href(p)}
            className="min-w-9 px-2 font-mono text-graphite-500 hover:text-ink"
          >
            {p}
          </Button>
        ),
      )}

      {current < totalPages ? (
        <Button variant="outline" shape="box" size="sm" href={href(current + 1)}>
          Next →
        </Button>
      ) : null}
    </nav>
  );
}
