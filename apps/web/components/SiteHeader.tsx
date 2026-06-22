import Link from 'next/link';

import styles from './SiteHeader.module.css';

export function SiteHeader() {
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
      </div>
    </header>
  );
}
