import Link from 'next/link';
import type { ReviewableType, ReviewStatus } from '@repo/api';

import { Badge, Button } from '../../components/ui';
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
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  await requireAdmin();

  const { status, type } = await searchParams;
  const active: ReviewStatus = STATUSES.includes(status as ReviewStatus)
    ? (status as ReviewStatus)
    : 'PENDING';

  const queue = await getSubmissions(active);

  // Chip list comes from the response itself so future reviewable types appear
  // automatically; an unknown ?type= is ignored.
  const typeKeys = Object.keys(queue.countsByType) as ReviewableType[];
  const activeType = typeKeys.includes(type as ReviewableType)
    ? (type as ReviewableType)
    : undefined;
  const items = activeType ? queue.items.filter((i) => i.type === activeType) : queue.items;
  const shownCount = activeType ? items.length : queue.total;
  const typeParam = activeType ? `&type=${activeType}` : '';

  return (
    <main className={styles.main}>
      <div className={styles.head}>
        <h1 className={styles.title}>Submission queue</h1>
        <p className={styles.sub}>
          {shownCount} {active.toLowerCase()} {activeType ? `${activeType} ` : ''}
          {shownCount === 1 ? 'item' : 'items'}
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
          All ({queue.total})
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
                    <span className={styles.label}>{item.label}</span>
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
              </div>
            </details>
          ))}
        </div>
      )}
    </main>
  );
}
