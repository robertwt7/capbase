import { getMergeCount, getReports, getSubmissionCount } from '../../lib/admin';
import { getSession } from '../../lib/auth';
import { AdminNav } from './AdminNav';

// Covers /admin and /admin/login (a client component, which can't export
// metadata itself). Belt-and-braces with the robots.txt disallow.
export const metadata = {
  title: 'Moderation',
  robots: { index: false, follow: false },
};

/**
 * No header of its own: the root layout's SiteHeader (logo, account, Sign out)
 * already sits above every admin page. This only adds the moderation sub-nav,
 * and only for an ADMIN session — signed-out visitors and ordinary users on
 * /admin/login see nothing admin-shaped, and make no count calls.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Non-redirecting read so this layout can wrap both the login screen and the
  // guarded pages. Page-level guards (requireAdmin) do the gating.
  const session = await getSession();
  const isAdmin = session?.role === 'ADMIN';

  const counts = isAdmin
    ? await Promise.all([pendingSubmissionCount(), openReportCount(), pendingMergeCount()]).then(
        ([queue, reports, merges]) => ({ queue, reports, merges }),
      )
    : null;

  return (
    <>
      {counts ? <AdminNav counts={counts} /> : null}
      {children}
    </>
  );
}

/** Pending submissions, for the nav badge. Never throws: the count is a
 *  convenience and the API being briefly unreachable should not blank the
 *  whole admin shell. A bare count — this runs on every admin page. */
async function pendingSubmissionCount(): Promise<number> {
  try {
    return await getSubmissionCount();
  } catch {
    return 0;
  }
}

/** Pending merge candidates, for the nav badge. Never throws, for the same
 *  reason as pendingSubmissionCount — building the queue itself here once
 *  stalled the whole admin. */
async function pendingMergeCount(): Promise<number> {
  try {
    return await getMergeCount('PENDING');
  } catch {
    return 0;
  }
}

/** Open reports, for the nav badge — the only signal a report arrived (there
 *  is no email). Never throws, for the same reason as pendingSubmissionCount. */
async function openReportCount(): Promise<number> {
  try {
    return (await getReports('OPEN')).total;
  } catch {
    return 0;
  }
}
