import Link from 'next/link';
import type { MyCompanyClaim } from '@repo/api';

import { Badge, Button, SectionHeader } from '@/components/ui';
import { claimMethodLabel, claimStatusLabel } from '@/lib/claim-status';
import { formatDay } from '@/lib/format';

import { withdrawClaimAction } from '../../companies/[slug]/claim/actions';

/** The companies the user represents (or asked to), each with its state and a Withdraw form.
 *  Rendered only when the user holds at least one claim. */
export function CompanyClaims({ claims }: { claims: MyCompanyClaim[] }) {
  if (claims.length === 0) return null;
  return (
    <section className="mt-10">
      <SectionHeader title="Companies you represent" size="md" />
      <ul>
        {claims.map((claim) => (
          <li
            key={claim.id}
            className="flex flex-col gap-3 border-b border-line py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/companies/${claim.companySlug}`}
                  prefetch={false}
                  className="font-display font-semibold text-ink hover:underline"
                >
                  {claim.companyName}
                </Link>
                <Badge
                  variant="pill"
                  mono
                  className={claim.status === 'active' ? 'border-ink text-ink' : undefined}
                >
                  {claimStatusLabel(claim)}
                </Badge>
              </div>
              <p className="mt-1 truncate font-sans text-[13px] text-graphite-500">
                {claimMethodLabel(claim)} ·{' '}
                {claim.verifiedAt
                  ? `verified ${formatDay(claim.verifiedAt)}`
                  : `sent ${formatDay(claim.createdAt)}`}
                {claim.lastConfirmedAt
                  ? ` · confirmed current ${formatDay(claim.lastConfirmedAt)}`
                  : ''}
              </p>
            </div>
            {claim.status !== 'ended' ? (
              <form action={withdrawClaimAction.bind(null, claim.id, claim.companySlug)}>
                <Button variant="outline" size="sm" type="submit">
                  {claim.status === 'pending' ? 'Withdraw request' : 'Withdraw'}
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
