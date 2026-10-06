import Link from 'next/link';
import {
  MODERATION_NOTE_MAX,
  REVIEWABLE_TYPES,
  type ReviewableType,
  type ReviewStatus,
} from '@repo/api';

import { Badge, Button, Textarea } from '../../components/ui';
import { getSubmissions } from '../../lib/admin';
import { requireAdmin } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { moderateAction } from './actions';
import { SubmissionDetail } from './SubmissionDetail';

import styles from './admin.module.css';

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
    <div className={styles.main}>
      <div className={styles.head}>
        <h1 className={styles.title}>Submission queue</h1>
        <p className={styles.sub}>
          {shownCount} {active.toLowerCase()} {activeType ? `${activeType} ` : ''}
          {shownCount === 1 ? 'item' : 'items'}
          {before || queue.nextCursor ? ' · newest first, 50 per page' : ''}
        </p>
      </div>

      <nav className={styles.tabs}>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin?status=${s}${typeParam}`}
            className={`${styles.tab} ${s === active ? styles.tabActive : ''}`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </Link>
        ))}
      </nav>

      <nav className={styles.typeFilter} aria-label="Filter by type">
        <Link
          href={`/admin?status=${active}`}
          className={`${styles.chip} ${!activeType ? styles.chipActive : ''}`}
        >
          All ({allCount})
        </Link>
        {typeKeys
          .filter((t) => queue.countsByType[t] > 0 || t === activeType)
          .map((t) => (
            <Link
              key={t}
              href={`/admin?status=${active}&type=${t}`}
              className={`${styles.chip} ${t === activeType ? styles.chipActive : ''}`}
            >
              {t} ({queue.countsByType[t]})
            </Link>
          ))}
      </nav>

      {items.length === 0 ? (
        <p className={styles.empty}>Nothing {active.toLowerCase()} right now.</p>
      ) : (
        <div className={styles.table} aria-label="Moderation queue">
          <div className={`${styles.row} ${styles.rowHead}`}>
            <span>Type</span>
            <span>Submission</span>
            <span>Submitted by</span>
            <span>Date</span>
            <span className={styles.actionsHead}>Decision</span>
          </div>

          {items.map((item) => (
            <details key={`${item.type}-${item.id}`} className={styles.rowDetails}>
              <summary className={styles.row}>
                <span>
                  <Badge variant="box" mono>
                    {item.type}
                  </Badge>
                </span>
                <span className={styles.subject}>
                  <span className={styles.chevron} aria-hidden="true">
                    ▸
                  </span>
                  <span className={styles.subjectText}>
                    <span className={styles.label}>
                      {item.label}
                      {/* Cited / uncited is visible without expanding the row,
                          so a moderator can triage the queue at a glance. */}
                      <span className={styles.sourceFlag}>
                        {item.sourceUrl ? 'cited' : 'uncited'}
                      </span>
                    </span>
                    {item.companyName ? (
                      <span className={styles.company}>{item.companyName}</span>
                    ) : null}
                  </span>
                </span>
                <span className={styles.meta}>
                  {item.submittedBy ? (
                    <span className={styles.submitter}>
                      <span className={styles.submitterName}>{item.submittedBy.name}</span>
                      <span className={styles.submitterEmail}>{item.submittedBy.email}</span>
                    </span>
                  ) : (
                    '—'
                  )}
                </span>
                <span className={styles.meta}>{formatDate(item.createdAt)}</span>
                <span className={styles.actions}>
                  <form action={moderateAction.bind(null, item.type, item.id, 'APPROVED')}>
                    <Button
                      variant="primary"
                      size="sm"
                      type="submit"
                      disabled={item.moderationStatus === 'APPROVED'}
                    >
                      Approve
                    </Button>
                  </form>
                  <form action={moderateAction.bind(null, item.type, item.id, 'REJECTED')}>
                    <Button
                      variant="outline"
                      size="sm"
                      type="submit"
                      disabled={item.moderationStatus === 'REJECTED'}
                    >
                      Reject
                    </Button>
                  </form>
                </span>
              </summary>
              <div className={styles.detailPanel}>
                <SubmissionDetail item={item} />
                {item.moderationStatus !== 'REJECTED' ? (
                  // The row's Reject button sends no reason; this one quotes the
                  // note in the contributor's email. The note is not stored.
                  <form
                    action={moderateAction.bind(null, item.type, item.id, 'REJECTED')}
                    className="mt-4 flex max-w-xl flex-col gap-2.5 border-t border-line pt-4"
                  >
                    <Textarea
                      name="note"
                      rows={2}
                      maxLength={MODERATION_NOTE_MAX}
                      aria-label="Reason for rejecting"
                      placeholder="Reason (optional) — emailed to the contributor"
                    />
                    <div>
                      <Button variant="outline" shape="box" size="sm" type="submit">
                        Reject with reason
                      </Button>
                    </div>
                  </form>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      )}

      {before || queue.nextCursor ? (
        <nav className="mt-6 flex items-center justify-center gap-2" aria-label="Pagination">
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
    </div>
  );
}
