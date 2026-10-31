import Link from 'next/link';
import {
  MODERATION_NOTE_MAX,
  REVIEWABLE_TYPES,
  type AdminUserDetail,
  type PendingSubmission,
  type ReviewableType,
  type ReviewStatus,
  type SubmissionSource,
} from '@repo/api';

import { Badge, Button, Card, Input, PageContainer, Textarea } from '../../components/ui';
import { getAdminUser, getSubmissions } from '../../lib/admin';
import { ApiError } from '../../lib/api';
import { requireAdmin } from '../../lib/auth';
import { formatCount, formatDay } from '../../lib/format';
import { cn } from '../../lib/utils';
import { moderateAction } from './actions';
import { FilterLink } from './FilterLink';
import { SubmissionDetail } from './SubmissionDetail';

const STATUSES: ReviewStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

/** Display names where the API's type key doesn't read as one (pill, then card badge). */
const TYPE_PILL: Partial<Record<ReviewableType, string>> = { investorProposal: 'Investor edits' };
const TYPE_BADGE: Partial<Record<ReviewableType, string>> = { investorProposal: 'investor edit' };

/** Everything the queue's URL can say. `source` is only ever `contributed` or `ingested` here:
 *  the web never asks for both at once (that is the /v1 default). */
interface QueueParams {
  status: ReviewStatus;
  type?: ReviewableType;
  source: Exclude<SubmissionSource, 'all'>;
  user?: string;
  q?: string;
  before?: string;
}

/** Ingest auto-approves, so only a decided status has ingested rows to show — and a
 *  rejected one only when an admin rejected an ingested row. */
const offersSource = (p: QueueParams) => p.status !== 'PENDING' && !p.user;

/** The queue URL for `current` with `overrides` applied. Every filter change drops the
 *  cursor (it is only valid for the order it came from), so only an explicit `before`
 *  survives. */
function queueHref(current: QueueParams, overrides: Partial<QueueParams> = {}): string {
  const next: QueueParams = { ...current, before: undefined, ...overrides };
  const params = new URLSearchParams({ status: next.status });
  if (next.type) params.set('type', next.type);
  if (next.user) params.set('user', next.user);
  if (next.source === 'ingested' && offersSource(next)) params.set('source', 'ingested');
  if (next.q) params.set('q', next.q);
  if (next.before) params.set('before', next.before);
  return `/admin?${params.toString()}`;
}

export const dynamic = 'force-dynamic';

export default async function AdminQueue({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    type?: string;
    before?: string;
    source?: string;
    user?: string;
    q?: string;
  }>;
}) {
  const me = await requireAdmin();

  const raw = await searchParams;
  const status: ReviewStatus = STATUSES.includes(raw.status as ReviewStatus)
    ? (raw.status as ReviewStatus)
    : 'PENDING';
  const current: QueueParams = {
    status,
    // An unknown ?type= is ignored.
    type: REVIEWABLE_TYPES.includes(raw.type as ReviewableType)
      ? (raw.type as ReviewableType)
      : undefined,
    source: 'contributed',
    user: raw.user || undefined,
    q: raw.q?.trim() || undefined,
    before: raw.before || undefined,
  };
  // The web defaults to people's submissions; a user filter implies them.
  if (raw.source === 'ingested' && offersSource(current)) current.source = 'ingested';
  // Decided contributions are ordered by when they were decided (the API's rule).
  const byDecision = status !== 'PENDING' && current.source === 'contributed';

  // One page, filtered by the API: APPROVED alone holds every ingested row.
  const [queue, account] = await Promise.all([
    getSubmissions({
      status,
      type: current.type,
      before: current.before,
      source: current.source,
      userId: current.user,
      q: current.q,
    }),
    current.user ? loadAccount(current.user) : Promise.resolve(null),
  ]);
  const { items } = queue;

  const typeKeys = Object.keys(queue.countsByType) as ReviewableType[];
  const allCount = typeKeys.reduce((sum, t) => sum + queue.countsByType[t], 0);
  const shownCount = queue.total;
  const statusWord = status.toLowerCase();

  return (
    <PageContainer className="py-9">
      <header className="border-b border-ink pb-6">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Submission queue
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] text-graphite-700">
          Crowdsourced rows waiting for review. Approving publishes the row and emails the
          contributor; a rejection reason is quoted in their email and not stored. Rejecting an
          approved row unpublishes it again.
        </p>
      </header>

      {current.user ? (
        <AccountCard account={account} clearHref={queueHref(current, { user: undefined })} />
      ) : null}

      <nav className="flex flex-wrap gap-2 pt-6" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <FilterLink key={s} href={queueHref(current, { status: s })} active={s === status}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
            {s === status ? ` (${formatCount(allCount)})` : ''}
          </FilterLink>
        ))}
      </nav>

      {offersSource(current) ? (
        <nav className="flex flex-wrap gap-2 pt-3" aria-label="Filter by source">
          <FilterLink
            href={queueHref(current, { source: 'contributed' })}
            active={current.source === 'contributed'}
          >
            Contributed
          </FilterLink>
          <FilterLink
            href={queueHref(current, { source: 'ingested' })}
            active={current.source === 'ingested'}
          >
            Ingested
          </FilterLink>
        </nav>
      ) : null}

      <nav className="flex flex-wrap items-center gap-2 pt-3" aria-label="Filter by type">
        <FilterLink href={queueHref(current, { type: undefined })} active={!current.type}>
          All ({formatCount(allCount)})
        </FilterLink>
        {typeKeys
          .filter((t) => queue.countsByType[t] > 0 || t === current.type)
          .map((t) => (
            <FilterLink key={t} href={queueHref(current, { type: t })} active={t === current.type}>
              {TYPE_PILL[t] ?? t} ({formatCount(queue.countsByType[t])})
            </FilterLink>
          ))}
      </nav>

      {/* A plain GET form: the other filters ride along as hidden inputs, and a new
          search starts from the first page. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-4">
        <form action="/admin" className="flex w-full max-w-md gap-2" role="search">
          <input type="hidden" name="status" value={status} />
          {current.type ? <input type="hidden" name="type" value={current.type} /> : null}
          {current.user ? <input type="hidden" name="user" value={current.user} /> : null}
          {current.source === 'ingested' ? (
            <input type="hidden" name="source" value="ingested" />
          ) : null}
          <Input
            name="q"
            defaultValue={current.q}
            placeholder="Company or firm name"
            aria-label="Filter by company or firm name"
            autoComplete="off"
          />
          <Button variant="outline" shape="box" size="sm" type="submit">
            Search
          </Button>
        </form>
        {current.q ? (
          <Link
            href={queueHref(current, { q: undefined })}
            className="font-mono text-[11px] tracking-[0.06em] text-graphite-700 uppercase underline underline-offset-[3px] hover:text-ink"
          >
            Clear search
          </Link>
        ) : null}
        <span className="ml-auto font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
          {formatCount(shownCount)} {statusWord}{' '}
          {current.type ? `${TYPE_PILL[current.type]?.toLowerCase() ?? current.type} ` : ''}
          {shownCount === 1 ? 'item' : 'items'}
          {byDecision ? ' · latest decision first' : ' · newest first'}
          {current.before || queue.nextCursor ? ' · 50 per page' : ''}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="mt-8 rounded-md border border-line bg-surface px-5 py-8 text-center text-[15px] text-graphite-500">
          {emptyMessage(current)}
        </p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4" aria-label="Moderation queue">
          {items.map((item) => (
            <li key={`${item.type}-${item.id}`}>
              <SubmissionCard
                item={item}
                byDecision={byDecision}
                meId={me.id}
                submitterHref={(id) => queueHref({ status, source: 'contributed', user: id })}
              />
            </li>
          ))}
        </ol>
      )}

      {current.before || queue.nextCursor ? (
        <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
          {current.before ? (
            <Button variant="outline" shape="box" size="sm" href={queueHref(current)}>
              ← Newest
            </Button>
          ) : null}
          {queue.nextCursor ? (
            <Button
              variant="outline"
              shape="box"
              size="sm"
              href={queueHref(current, { before: queue.nextCursor })}
            >
              Older →
            </Button>
          ) : null}
        </nav>
      ) : null}
    </PageContainer>
  );
}

/** "Nothing approved matching “acme” from this account." — says which filters emptied it. */
function emptyMessage(p: QueueParams): string {
  const parts = [`Nothing ${p.status.toLowerCase()}`];
  if (p.source === 'ingested') parts.push('from ingest');
  if (p.type) parts.push(`of type ${TYPE_PILL[p.type]?.toLowerCase() ?? p.type}`);
  if (p.q) parts.push(`matching “${p.q}”`);
  if (p.user) parts.push('from this account');
  return parts.length === 1 ? `${parts[0]} right now.` : `${parts.join(' ')}.`;
}

/** The per-user card, or null when the id names no account (the API 404s). */
async function loadAccount(id: string): Promise<AdminUserDetail | null> {
  try {
    return await getAdminUser(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Where this account stands with the read gate right now. */
function accessLine(account: AdminUserDetail): string {
  if (account.role !== 'USER') return `Always unlocked (${account.role})`;
  const until = account.access.unlockedUntil;
  if (account.access.unlocked && until) return `Unlocked until ${formatDay(until)}`;
  if (until) return `Locked — access lapsed ${formatDay(until)}`;
  return 'Locked — no approved contribution';
}

/** Who the per-user view is showing: identity, standing, what they have sent, and
 *  whether that has them unlocked — so a retraction's effect is visible at once. */
function AccountCard({
  account,
  clearHref,
}: {
  account: AdminUserDetail | null;
  clearHref: string;
}) {
  const clear = (
    <Link
      href={clearHref}
      className="font-mono text-[11px] tracking-[0.06em] text-graphite-700 uppercase underline underline-offset-[3px] hover:text-ink"
    >
      Clear
    </Link>
  );
  if (!account) {
    return (
      <Card className="mt-6 flex flex-wrap items-baseline justify-between gap-3 p-5">
        <p className="text-[15px] text-graphite-700">No account has this id.</p>
        {clear}
      </Card>
    );
  }
  const { contributions } = account;
  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-display text-[17px] font-semibold text-ink [overflow-wrap:anywhere]">
          {account.name}
        </span>
        {account.role !== 'USER' ? (
          <Badge variant="box" mono>
            {account.role}
          </Badge>
        ) : null}
        {account.bannedAt ? (
          <Badge variant="pill" mono className="border-ink font-semibold text-ink">
            Banned {formatDay(account.bannedAt)}
          </Badge>
        ) : null}
        <span className="ml-auto">{clear}</span>
      </div>
      <p className="mt-1 font-mono text-[12px] text-graphite-500 [overflow-wrap:anywhere]">
        {account.email}
      </p>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-line pt-4">
        {STATUSES.map((s) => (
          <div key={s}>
            <dt className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
              {s.toLowerCase()}
            </dt>
            <dd className="font-mono text-[15px] text-ink tabular-nums">
              {formatCount(contributions[s])}
            </dd>
          </div>
        ))}
        <div className="min-w-0">
          <dt className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
            Access
          </dt>
          <dd className="text-[15px] text-ink">{accessLine(account)}</dd>
        </div>
      </dl>
    </Card>
  );
}

/** One submission, fully open: what it is and who sent it, every field, then
 *  the decision. Nothing needs a click to be read. */
function SubmissionCard({
  item,
  byDecision,
  meId,
  submitterHref,
}: {
  item: PendingSubmission;
  /** The list is ordered by decision time, so that is the date to show. */
  byDecision: boolean;
  meId: string;
  submitterHref: (userId: string) => string;
}) {
  const cited = Boolean(item.sourceUrl);
  // A new company has no public profile until it is approved; an investor edit
  // hangs off a live firm; every other submission (proposals included) off a live company.
  const company =
    item.type === 'company' ? (
      'New company'
    ) : item.investorSlug && item.investorName ? (
      <Link
        prefetch={false}
        href={`/investors/${item.investorSlug}`}
        className="text-ink underline underline-offset-[3px]"
      >
        {item.investorName}
      </Link>
    ) : item.companySlug && item.companyName ? (
      <Link
        prefetch={false}
        href={`/companies/${item.companySlug}`}
        className="text-ink underline underline-offset-[3px]"
      >
        {item.companyName}
      </Link>
    ) : null;
  // The submitter opens their own view: everything they sent, in this status.
  const submitter = item.submittedBy ? (
    <>
      by{' '}
      <Link
        href={submitterHref(item.submittedBy.id)}
        className="text-ink underline underline-offset-[3px]"
      >
        {item.submittedBy.name}
      </Link>{' '}
      &lt;{item.submittedBy.email}&gt;
    </>
  ) : (
    'Ingested automatically'
  );
  const decided =
    item.moderationStatus !== 'PENDING' && item.reviewedAt
      ? `${item.moderationStatus === 'APPROVED' ? 'Approved' : 'Rejected'}${
          item.reviewedBy
            ? ` by ${item.reviewedBy.id === meId ? 'you' : item.reviewedBy.name}`
            : ''
        } · ${formatDay(item.reviewedAt)}`
      : null;
  const shownAt = byDecision && item.reviewedAt ? item.reviewedAt : item.createdAt;

  return (
    <Card className="p-5">
      {/* Line 1: type, what it is, provenance, when — triage at a glance. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge variant="box" mono>
          {TYPE_BADGE[item.type] ?? item.type}
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
          <time dateTime={shownAt}>{formatDay(shownAt)}</time>
        </span>
      </div>
      {/* Line 2: where it belongs, who sent it, who decided it. */}
      <p className="mt-1.5 font-mono text-[12px] text-graphite-500 [overflow-wrap:anywhere]">
        {company ? <>{company} · </> : null}
        {submitter}
        {decided ? <> · {decided}</> : null}
      </p>

      <div className="mt-4 border-t border-line pt-4">
        <SubmissionDetail item={item} />
      </div>

      {/* One form, two decisions: each button picks its action via formAction.
          Always rendered — one of the two is available in every status. The
          reason only travels with a rejection (moderateAction drops it on
          approve), so there is no box once the row is already rejected. */}
      <form className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
        {item.moderationStatus === 'APPROVED' ? (
          <p className="text-[13px] text-graphite-700">
            Rejecting unpublishes it
            {item.type === 'proposal' || item.type === 'investorProposal'
              ? ' and restores the old values of fields not changed since.'
              : '.'}
          </p>
        ) : null}
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
