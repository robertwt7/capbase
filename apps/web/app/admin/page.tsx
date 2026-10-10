import Link from 'next/link';
import {
  MODERATION_NOTE_MAX,
  REVIEWABLE_TYPES,
  type PendingSubmission,
  type ReviewableType,
  type ReviewStatus,
} from '@repo/api';

import { Badge, Button, Card, PageContainer, Textarea } from '../../components/ui';
import { getSubmissions } from '../../lib/admin';
import { requireAdmin } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { cn } from '../../lib/utils';
import { moderateAction } from './actions';
import { FilterLink } from './FilterLink';
import { SubmissionDetail } from './SubmissionDetail';

const STATUSES: ReviewStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

export const dynamic = 'force-dynamic';

export default async function AdminQueue({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; before?: string }>;
}) {
  await requireAdmin();

  const { status, type, before } = await searchParams;
  const active: ReviewStatus = STATUSES.includes(status as ReviewStatus)
    ? (status as ReviewStatus)
    : 'PENDING';
  // An unknown ?type= is ignored.
  const activeType = REVIEWABLE_TYPES.includes(type as ReviewableType)
    ? (type as ReviewableType)
    : undefined;

  // One page, filtered by the API: APPROVED alone holds every ingested row.
  const queue = await getSubmissions(active, activeType, before);
  const { items } = queue;

  const typeKeys = Object.keys(queue.countsByType) as ReviewableType[];
  const allCount = typeKeys.reduce((sum, t) => sum + queue.countsByType[t], 0);
  const shownCount = queue.total;
  const typeParam = activeType ? `&type=${activeType}` : '';

  return (
    <PageContainer className="py-9">
      <header className="border-b border-ink pb-6">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Submission queue
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] text-graphite-700">
          Crowdsourced rows waiting for review. Approving publishes the row and emails the
          contributor; a rejection reason is quoted in their email and not stored.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 pt-6" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <FilterLink key={s} href={`/admin?status=${s}${typeParam}`} active={s === active}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
            {s === active ? ` (${allCount})` : ''}
          </FilterLink>
        ))}
      </nav>

      <nav className="flex flex-wrap items-center gap-2 pt-3" aria-label="Filter by type">
        <FilterLink href={`/admin?status=${active}`} active={!activeType}>
          All ({allCount})
        </FilterLink>
        {typeKeys
          .filter((t) => queue.countsByType[t] > 0 || t === activeType)
          .map((t) => (
            <FilterLink
              key={t}
              href={`/admin?status=${active}&type=${t}`}
              active={t === activeType}
            >
              {t} ({queue.countsByType[t]})
            </FilterLink>
          ))}
        <span className="ml-auto font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
          {shownCount} {active.toLowerCase()} {activeType ? `${activeType} ` : ''}
          {shownCount === 1 ? 'item' : 'items'}
          {before || queue.nextCursor ? ' · newest first · 50 per page' : ''}
        </span>
      </nav>

      {items.length === 0 ? (
        <p className="mt-8 rounded-md border border-line bg-surface px-5 py-8 text-center text-[15px] text-graphite-500">
          Nothing {active.toLowerCase()} right now.
        </p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4" aria-label="Moderation queue">
          {items.map((item) => (
            <li key={`${item.type}-${item.id}`}>
              <SubmissionCard item={item} />
            </li>
          ))}
        </ol>
      )}

      {before || queue.nextCursor ? (
        <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
          {before ? (
            <Button variant="outline" shape="box" size="sm" href={`/admin?status=${active}${typeParam}`}>
              ← Newest
            </Button>
          ) : null}
          {queue.nextCursor ? (
            <Button
              variant="outline"
              shape="box"
              size="sm"
              href={`/admin?status=${active}${typeParam}&before=${encodeURIComponent(queue.nextCursor)}`}
            >
              Older →
            </Button>
          ) : null}
        </nav>
      ) : null}
    </PageContainer>
  );
}

/** One submission, fully open: what it is and who sent it, every field, then
 *  the decision. Nothing needs a click to be read. */
function SubmissionCard({ item }: { item: PendingSubmission }) {
  const cited = Boolean(item.sourceUrl);
  // A new company has no public profile until it is approved; every other
  // submission (proposals included) hangs off a live one.
  const company =
    item.type === 'company' ? (
      'New company'
    ) : item.companySlug && item.companyName ? (
      <Link
        prefetch={false}
        href={`/companies/${item.companySlug}`}
        className="text-ink underline underline-offset-[3px]"
      >
        {item.companyName}
      </Link>
    ) : null;
  const submitter = item.submittedBy
    ? `by ${item.submittedBy.name} <${item.submittedBy.email}>`
    : 'Ingested automatically';

  return (
    <Card className="p-5">
      {/* Line 1: type, what it is, provenance, when — triage at a glance. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge variant="box" mono>
          {item.type}
        </Badge>
        <span className="font-display text-[17px] font-semibold text-ink [overflow-wrap:anywhere]">
          {item.label}
        </span>
        {/* Monochrome: cited reads stronger (ink border), uncited quieter —
            never alarming, red is reserved for validation errors. */}
        <Badge variant="pill" mono className={cn(cited && 'border-ink text-ink')}>
          {cited ? 'cited' : 'uncited'}
        </Badge>
        {item.moderationStatus !== 'PENDING' ? (
          <Badge variant="pill" mono>
            {item.moderationStatus}
          </Badge>
        ) : null}
        <span className="ml-auto font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
          {formatDate(item.createdAt)}
        </span>
      </div>
      {/* Line 2: where it belongs, who sent it. */}
      <p className="mt-1.5 font-mono text-[12px] text-graphite-500 [overflow-wrap:anywhere]">
        {company ? <>{company} · </> : null}
        {submitter}
      </p>

      <div className="mt-4 border-t border-line pt-4">
        <SubmissionDetail item={item} />
      </div>

      {/* One form, two decisions: each button picks its action via formAction.
          Always rendered — one of the two is available in every status. The
          reason only travels with a rejection (moderateAction drops it on
          approve), so there is no box once the row is already rejected. */}
      <form className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
        {item.moderationStatus !== 'REJECTED' ? (
          <Textarea
            name="note"
            rows={2}
            maxLength={MODERATION_NOTE_MAX}
            aria-label="Reason for rejecting"
            placeholder="Reason (optional) — emailed to the contributor if you reject"
          />
        ) : null}
        <div className="flex flex-wrap gap-2.5">
          <Button
            variant="primary"
            shape="box"
            size="sm"
            type="submit"
            disabled={item.moderationStatus === 'APPROVED'}
            formAction={moderateAction.bind(null, item.type, item.id, 'APPROVED')}
          >
            Approve
          </Button>
          <Button
            variant="outline"
            shape="box"
            size="sm"
            type="submit"
            disabled={item.moderationStatus === 'REJECTED'}
            formAction={moderateAction.bind(null, item.type, item.id, 'REJECTED')}
          >
            Reject
          </Button>
        </div>
      </form>
    </Card>
  );
}
