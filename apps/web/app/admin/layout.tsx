import Link from 'next/link';

import { Logo } from '../../components/Logo';
import { Button, Eyebrow } from '../../components/ui';
import { getMergeCount, getReports } from '../../lib/admin';
import { getSession } from '../../lib/auth';
import { logoutAction } from './actions';

import styles from './admin.module.css';

// Covers /admin and /admin/login (a client component, which can't export
// metadata itself). Belt-and-braces with the robots.txt disallow.
export const metadata = {
  title: 'Moderation',
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Non-redirecting read so this layout can wrap both the login screen (no
  // session) and the guarded queue (session). Page-level guards do the gating.
  const session = await getSession();

  // Signed-out visitors get no count — the queue is admin-only, and a failed
  // fetch must not take the login screen down with it.
  const [pendingMerges, openReports] = session
    ? await Promise.all([pendingMergeCount(), openReportCount()])
    : [0, 0];

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/admin" className={styles.brand} aria-label="Capbase moderation">
          <Logo className="h-5" title="" />
          <Eyebrow className={styles.brandTag}>moderation</Eyebrow>
        </Link>
        {session ? (
          <div className={styles.session}>
            <Link
              href="/admin/reports"
              className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase transition-colors hover:text-ink"
            >
              Reports{openReports > 0 ? ` (${openReports})` : ''}
            </Link>
            <Link
              href="/admin/merges"
              className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase transition-colors hover:text-ink"
            >
              Merges{pendingMerges > 0 ? ` (${pendingMerges})` : ''}
            </Link>
            <Link
              href="/admin/users"
              className="font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase transition-colors hover:text-ink"
            >
              Users
            </Link>
            <span className={styles.sessionWho}>{session.email}</span>
            <form action={logoutAction}>
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        ) : (
          <Button variant="ghost" size="sm" href="/">
            ← Back to site
          </Button>
        )}
      </header>
      {children}
    </div>
  );
}

/** Pending merge candidates, for the nav badge. Never throws: the count is a
 *  convenience and the API being briefly unreachable should not blank the
 *  whole admin shell. A bare count — this runs on every admin page, and
 *  building the queue itself here once stalled the whole admin. */
async function pendingMergeCount(): Promise<number> {
  try {
    return await getMergeCount('PENDING');
  } catch {
    return 0;
  }
}

/** Open reports, for the nav badge — the only signal a report arrived (there
 *  is no email). Never throws, for the same reason as pendingMergeCount. */
async function openReportCount(): Promise<number> {
  try {
    return (await getReports('OPEN')).total;
  } catch {
    return 0;
  }
}
