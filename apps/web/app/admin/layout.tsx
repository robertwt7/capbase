import Link from 'next/link';

import { Button, Eyebrow } from '../../components/ui';
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
          Capbase <Eyebrow className={styles.brandTag}>moderation</Eyebrow>
        </Link>
        {session ? (
          <div className={styles.session}>
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
