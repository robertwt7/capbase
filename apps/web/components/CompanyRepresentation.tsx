import type { CompanyDetailResponse } from '@repo/api';

import { formatDay } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * "Profile maintained by the company" — shown while at least one verified representative's
 * claim is active. The confirmed date is attributed to the company, so it can never be read as
 * a source's retrieval date. Capbase's own fact: never in metadata, JSON-LD or the OG image.
 */
export function CompanyRepresentation({
  representation,
  className,
}: {
  representation: CompanyDetailResponse['representation'];
  className?: string;
}) {
  if (!representation) return null;
  return (
    <p className={cn('font-mono text-xs text-graphite-500', className)}>
      Profile maintained by the company
      {representation.lastConfirmedAt ? (
        <>
          {' · '}
          <span className="whitespace-nowrap">
            Confirmed current by the company on{' '}
            <time dateTime={representation.lastConfirmedAt}>
              {formatDay(representation.lastConfirmedAt)}
            </time>
          </span>
        </>
      ) : null}
    </p>
  );
}
