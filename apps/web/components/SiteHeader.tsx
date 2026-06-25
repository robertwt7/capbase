import Link from 'next/link';

import { logout } from '../app/(account)/actions';
import { getSession } from '../lib/auth';

import styles from './SiteHeader.module.css';

export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="Capbase home">
          <span className={styles.mark} aria-hidden="true" />
          <span className={styles.wordmark}>Capbase</span>
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          <Link href="/" className={styles.navLink}>
            Companies
          </Link>
          <Link href="/" className={styles.navLink}>
            Investors
          </Link>
          <Link href="/" className={styles.navLink}>
            Markets
          </Link>
        </nav>

        <form className={styles.search} role="search" action="/">
          <span className={styles.searchKey} aria-hidden="true">
            /
          </span>
          <input
            className={styles.searchInput}
            type="search"
            name="q"
            placeholder="Search companies, investors, sectors"
            aria-label="Search Capbase"
          />
        </form>

        <div className={styles.account}>
          {session ? (
            <>
              <Link href="/contribute" className={styles.cta}>
                Contribute
              </Link>
              <Link href="/profile" className={styles.accountLink}>
                {session.name}
              </Link>
              <form action={logout}>
                <button type="submit" className={styles.accountLink}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className={styles.accountLink}>
                Sign in
              </Link>
              <Link href="/register" className={styles.cta}>
                Join
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
