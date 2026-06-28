import Link from 'next/link';
import type { ReviewStatus } from '@repo/api';

import { Button, Tag } from '../../components/ui';
import { getSubmissions } from '../../lib/admin';
import { requireAdmin } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { moderateAction } from './actions';

import styles from './admin.module.css';

const STATUSES: ReviewStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

export const dynamic = 'force-dynamic';

export default async function AdminQueue({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();

  const { status } = await searchParams;
  const active: ReviewStatus = STATUSES.includes(status as ReviewStatus)
    ? (status as ReviewStatus)
    : 'PENDING';

  const queue = await getSubmissions(active);

  return (
    <main className={styles.main}>
      <div className={styles.head}>
        <h1 className={styles.title}>Submission queue</h1>
        <p className={styles.sub}>
          {queue.total} {active.toLowerCase()} {queue.total === 1 ? 'item' : 'items'}
        </p>
      </div>

      <nav className={styles.tabs}>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin?status=${s}`}
            className={`${styles.tab} ${s === active ? styles.tabActive : ''}`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </Link>
        ))}
      </nav>

      {queue.items.length === 0 ? (
        <p className={styles.empty}>Nothing {active.toLowerCase()} right now.</p>
      ) : (
        <div className={styles.table} role="table" aria-label="Moderation queue">
          <div className={`${styles.row} ${styles.rowHead}`} role="row">
            <span role="columnheader">Type</span>
            <span role="columnheader">Submission</span>
            <span role="columnheader">Submitted by</span>
            <span role="columnheader">Date</span>
            <span role="columnheader" className={styles.actionsHead}>
              Decision
            </span>
          </div>

          {queue.items.map((item) => (
            <div key={`${item.type}-${item.id}`} className={styles.row} role="row">
              <span role="cell">
                <Tag variant="box" mono>
                  {item.type}
                </Tag>
              </span>
              <span role="cell" className={styles.subject}>
                <span className={styles.label}>{item.label}</span>
                {item.companyName ? (
                  <span className={styles.company}>{item.companyName}</span>
                ) : null}
              </span>
              <span role="cell" className={styles.meta}>
                {item.submittedBy ? item.submittedBy.name : '—'}
              </span>
              <span role="cell" className={styles.meta}>
                {formatDate(item.createdAt)}
              </span>
              <span role="cell" className={styles.actions}>
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
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
