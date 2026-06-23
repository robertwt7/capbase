import Link from 'next/link';

import { getSession } from '../../lib/auth';
import { logoutAction } from './actions';

import styles from './admin.module.css';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Non-redirecting read so this layout can wrap both the login screen (no
  // session) and the guarded queue (session). Page-level guards do the gating.
  const session = await getSession();

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/admin" className={styles.brand}>
          Capbase <span className={styles.brandTag}>moderation</span>
        </Link>
        {session ? (
          <div className={styles.session}>
            <span className={styles.sessionWho}>{session.email}</span>
            <form action={logoutAction}>
              <button type="submit" className={styles.linkBtn}>
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <Link href="/" className={styles.linkBtn}>
            ← Back to site
          </Link>
        )}
      </header>
      {children}
    </div>
  );
}
