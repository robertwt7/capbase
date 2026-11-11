import Link from 'next/link';
import {
  ADMIN_CLAIM_STATUS_FILTERS,
  MODERATION_NOTE_MAX,
  type AdminClaim,
  type AdminClaimStatusFilter,
} from '@repo/api';

import { Badge, Button, Card, PageContainer, Pagination, Textarea } from '../../../components/ui';
import { getAdminClaims } from '../../../lib/admin';
import { requireAdmin } from '../../../lib/auth';
import { claimMethodLabel, claimStatusLabel } from '../../../lib/claim-status';
import { formatDay } from '../../../lib/format';
import { cn } from '../../../lib/utils';
import { claimDecisionAction } from '../actions';
import { FilterLink } from '../FilterLink';

const LABEL: Record<AdminClaimStatusFilter, string> = {
  pending: 'Pending',
  active: 'Active',
  ended: 'Ended',
};

export const dynamic = 'force-dynamic';

/** Company claims: manual requests to decide, live claims to revoke. A claim grants no
 *  moderation power and never unlocks profiles — it labels the representative's submissions
 *  and shows "Profile maintained by the company". */
export default async function ClaimsQueue({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requireAdmin();
  const { status, page } = await searchParams;
  const active: AdminClaimStatusFilter = ADMIN_CLAIM_STATUS_FILTERS.includes(
    status as AdminClaimStatusFilter,
  )
    ? (status as AdminClaimStatusFilter)
    : 'pending';
  const pageNum = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const claims = await getAdminClaims(active, pageNum);

  return (
    <PageContainer className="py-9">
      <header className="border-b border-ink pb-6">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Company claims
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] text-graphite-700">
          People who say they represent a company. Email claims verify themselves through a link
          to an address at the company&apos;s domain; manual requests wait here for a decision.
          A claim labels the representative&apos;s submissions in the queue and marks the profile
          as maintained by the company. It publishes nothing and unlocks nothing. A rejection
          reason is quoted in the email and not stored.
        </p>
      </header>

      <nav className="flex flex-wrap items-center gap-2 pt-6" aria-label="Filter by status">
        {ADMIN_CLAIM_STATUS_FILTERS.map((s) => (
          <FilterLink key={s} href={`/admin/claims?status=${s}`} active={s === active}>
            {LABEL[s]}
            {s === active ? ` (${claims.total})` : ''}
          </FilterLink>
        ))}
      </nav>

      {claims.items.length === 0 ? (
        <p className="mt-8 rounded-md border border-line bg-surface px-5 py-8 text-center text-[15px] text-graphite-500">
          No {LABEL[active].toLowerCase()} claims right now.
        </p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4" aria-label="Company claims">
          {claims.items.map((claim) => (
            <li key={claim.id}>
              <ClaimCard claim={claim} />
            </li>
          ))}
        </ol>
      )}

      <Pagination
        className="mt-8"
        page={claims.page}
        pageSize={claims.pageSize}
        total={claims.total}
        href={(p) => `/admin/claims?status=${active}${p > 1 ? `&page=${p}` : ''}`}
      />
    </PageContainer>
  );
}

function ClaimCard({ claim }: { claim: AdminClaim }) {
  const live = claim.status === 'active' || claim.status === 'suspended';
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge variant="box" mono>
          {claim.method === 'EMAIL' ? 'email' : 'manual'}
        </Badge>
        <Link
          prefetch={false}
          href={`/companies/${claim.companySlug}`}
          className="font-display text-[17px] font-semibold text-ink underline-offset-[3px] hover:underline [overflow-wrap:anywhere]"
        >
          {claim.companyName}
        </Link>
        <Badge variant="pill" mono className={cn(claim.status === 'active' && 'border-ink text-ink')}>
          {claimStatusLabel(claim)}
        </Badge>
        <span className="ml-auto font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
          <time dateTime={claim.createdAt}>{formatDay(claim.createdAt)}</time>
        </span>
      </div>
      <p className="mt-1.5 font-mono text-[12px] text-graphite-500 [overflow-wrap:anywhere]">
        by{' '}
        <Link
          href={`/admin?user=${encodeURIComponent(claim.userId)}&status=PENDING`}
          className="text-ink underline underline-offset-[3px]"
        >
          {claim.userName}
        </Link>{' '}
        &lt;{claim.userEmail}&gt; · {claimMethodLabel(claim)}
        {claim.verifiedAt
          ? ` · ${claim.method === 'MANUAL' ? 'approved' : 'verified'} ${formatDay(claim.verifiedAt)}${
              claim.verifiedBy ? ` by ${claim.verifiedBy}` : ''
            }`
          : ''}
        {claim.revokedAt
          ? ` · ended ${formatDay(claim.revokedAt)}${claim.revokedBy ? ` by ${claim.revokedBy}` : ''}`
          : ''}
      </p>

      {claim.note || claim.evidenceUrl ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          {claim.note ? (
            <p className="text-[15px] whitespace-pre-line text-graphite-900 [overflow-wrap:anywhere]">
              {claim.note}
            </p>
          ) : null}
          {claim.evidenceUrl ? (
            <a
              href={claim.evidenceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="font-mono text-[12px] text-ink underline underline-offset-[3px] [overflow-wrap:anywhere]"
            >
              {claim.evidenceUrl}
            </a>
          ) : (
            <p className="font-mono text-[12px] text-graphite-500">No evidence link.</p>
          )}
        </div>
      ) : null}

      {claim.status === 'pending' ? (
        // One form, two decisions: each button picks its action via formAction. The reason
        // only travels with a rejection.
        <form className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
          <Textarea
            name="note"
            rows={2}
            maxLength={MODERATION_NOTE_MAX}
            placeholder="Reason for rejecting (optional — quoted in the email, not stored)"
            aria-label="Reason for rejecting"
          />
          <div className="flex flex-wrap gap-2.5">
            <Button
              variant="primary"
              shape="box"
              size="sm"
              type="submit"
              formAction={claimDecisionAction.bind(null, claim.id, 'approve')}
            >
              Approve
            </Button>
            <Button
              variant="outline"
              shape="box"
              size="sm"
              type="submit"
              formAction={claimDecisionAction.bind(null, claim.id, 'reject')}
            >
              Reject
            </Button>
          </div>
        </form>
      ) : live ? (
        <form
          action={claimDecisionAction.bind(null, claim.id, 'revoke')}
          className="mt-4 flex items-center gap-3 border-t border-line pt-4"
        >
          <Button variant="outline" shape="box" size="sm" type="submit">
            Revoke
          </Button>
          <span className="text-[13px] text-graphite-500">
            Ends the claim at once and emails the representative.
          </span>
        </form>
      ) : null}
    </Card>
  );
}
