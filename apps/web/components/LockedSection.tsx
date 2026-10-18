import { CONTRIBUTION_WINDOW_DAYS, type ViewerAccess } from '@repo/api';

import { Button, Card } from '@/components/ui';
import { formatCount, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The geometry the withheld rows had: a Funding Ladder rung, a profile card,
 *  a table row, or a block of fund terms. */
export type PlaceholderShape = 'rung' | 'card' | 'row' | 'terms';

/** At most this many placeholders, whatever is withheld — they show that rows
 *  exist, not how many (the panel says that). */
const MAX_PLACEHOLDERS = 3;

const block = 'rounded-sm bg-graphite-200';

/**
 * What a gated section shows in place of the rows the API withheld: a few
 * blurred placeholder shapes under a tier-aware call to action.
 *
 * The placeholders carry NO text — fake copy would be indexed and read as
 * data. The rows were never sent (the API gates them), so there is nothing
 * real to blur either. They are `aria-hidden` and `inert`, so focus and screen
 * readers reach only the panel, which is `data-nosnippet` so search engines
 * never quote it. Renders nothing for an unlocked viewer, or when the section
 * shows every row.
 */
export function LockedSection({
  access,
  total,
  shown,
  noun,
  subject,
  placeholder,
  next,
  contributeHref = '/contribute',
  className,
}: {
  access: ViewerAccess;
  /** Every row of the section (the public count). */
  total: number;
  /** Rows the page rendered. */
  shown: number;
  /** Plural, lower case: "rounds", "investors". */
  noun: string;
  /** For a block that is withheld whole rather than counted (a fund's terms):
   *  "The fund's terms". The panel then names it instead of counting rows. */
  subject?: string;
  placeholder: PlaceholderShape;
  /** Where sign-in returns to. */
  next: string;
  /** Where "Contribute to unlock" leads. */
  contributeHref?: string;
  className?: string;
}) {
  if (access.unlocked || total <= shown) return null;
  const hidden = total - shown;
  const lapsed =
    access.unlockedUntil && new Date(access.unlockedUntil).getTime() < Date.now()
      ? access.unlockedUntil
      : null;

  return (
    <div className={cn('relative mt-3.5 min-h-[168px] overflow-hidden rounded-[10px]', className)}>
      <div
        aria-hidden
        inert
        className={cn(
          'pointer-events-none grid gap-px blur-[5px] select-none',
          placeholder === 'card' ? 'grid-cols-2 max-[600px]:grid-cols-1' : 'grid-cols-1',
        )}
      >
        {Array.from({ length: Math.min(hidden, MAX_PLACEHOLDERS) }, (_, i) => (
          <Placeholder key={i} shape={placeholder} />
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-paper/45 p-4">
        <Card data-nosnippet className="flex max-w-[460px] flex-col items-start gap-3 p-5">
          {access.signedIn ? (
            <>
              <p className="font-sans text-[13px] leading-relaxed text-graphite-700">
                {lapsed && <>Your access lapsed on {formatDate(lapsed)}. </>}
                {subject ? (
                  <>{subject} open with any approved contribution, which unlocks every profile for{' '}
                    {CONTRIBUTION_WINDOW_DAYS} days.</>
                ) : (
                  <>
                    Showing <span className="font-mono text-ink">{formatCount(shown)}</span> of{' '}
                    <span className="font-mono text-ink">{formatCount(total)}</span> {noun} — any
                    approved contribution unlocks every profile for {CONTRIBUTION_WINDOW_DAYS} days.
                  </>
                )}
              </p>
              <Button variant="primary" shape="pill" size="sm" href={contributeHref}>
                Contribute to unlock
              </Button>
            </>
          ) : (
            <>
              <p className="font-sans text-[13px] leading-relaxed text-graphite-700">
                {subject ? (
                  <>{subject} open to contributors: sign in, and any approved contribution unlocks
                    every profile for {CONTRIBUTION_WINDOW_DAYS} days.</>
                ) : (
                  <>
                    Sign in to see <span className="font-mono text-ink">{formatCount(hidden)}</span>{' '}
                    {shown > 0 ? 'more ' : ''}
                    {noun}.
                  </>
                )}
              </p>
              <Button
                variant="primary"
                shape="pill"
                size="sm"
                href={`/login?next=${encodeURIComponent(next)}`}
              >
                Sign in
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Placeholder({ shape }: { shape: PlaceholderShape }) {
  switch (shape) {
    case 'rung':
      return (
        <div className="grid grid-cols-[110px_1fr_90px] items-center gap-5 bg-surface px-[18px] py-5">
          <span className={cn(block, 'h-3.5')} />
          <span className={cn(block, 'h-2.5 w-2/3')} />
          <span className={cn(block, 'h-3.5')} />
        </div>
      );
    case 'card':
      return (
        <div className="flex flex-col gap-2.5 bg-surface px-[18px] py-5">
          <span className={cn(block, 'h-3.5 w-1/2')} />
          <span className={cn(block, 'h-2.5 w-3/4')} />
          <span className={cn(block, 'h-2.5 w-1/3')} />
        </div>
      );
    case 'row':
      return (
        <div className="grid grid-cols-[1fr_120px_90px] items-center gap-5 bg-surface px-[18px] py-4">
          <span className={cn(block, 'h-3.5 w-2/3')} />
          <span className={cn(block, 'h-2.5')} />
          <span className={cn(block, 'h-3.5')} />
        </div>
      );
    case 'terms':
      return (
        <div className="grid grid-cols-4 gap-x-8 gap-y-4 bg-surface px-[18px] py-5 max-[600px]:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="flex flex-col gap-2">
              <span className={cn(block, 'h-2 w-2/3')} />
              <span className={cn(block, 'h-3.5 w-1/2')} />
            </span>
          ))}
        </div>
      );
  }
}
