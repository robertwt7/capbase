import Link from 'next/link';

import { CompanyLogo } from '../components/CompanyLogo';
import { Eyebrow, SectionHeader, Stat, Tag } from '../components/ui';
import { getCompanies, getMarketStats, getMarketTotals } from '../lib/data';
import { formatCount, formatUsd, signedPct } from '../lib/format';

import styles from './page.module.css';

export default async function Home() {
  const [companies, marketStats, marketTotals] = await Promise.all([
    getCompanies(),
    getMarketStats(),
    getMarketTotals(),
  ]);

  return (
    <main>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <Eyebrow className={styles.eyebrow}>
            {marketTotals.quarter} · private market intelligence
          </Eyebrow>
          <h1 className={styles.headline}>
            The cap table of the private economy, in the open.
          </h1>
          <p className={styles.lede}>
            Funding rounds, investors, people, and exits for the companies
            shaping each sector — sourced openly, free to read, free to build on.
          </p>
        </div>

        <div className={styles.tape} aria-label={`${marketTotals.quarter} market totals`}>
          <Stat size="lg" label="Capital deployed" value={formatUsd(marketTotals.totalRaisedUsd)} />
          <Stat size="lg" label="Disclosed deals" value={formatCount(marketTotals.dealCount)} />
          <Stat size="lg" label="New unicorns" value={formatCount(marketTotals.newUnicorns)} />
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader title="Sectors this quarter" note="Deal volume vs. prior quarter" />
        <div className={styles.sectors}>
          {marketStats.map((stat) => (
            <article key={stat.sector} className={styles.sector}>
              <h3 className={styles.sectorName}>{stat.sector}</h3>
              <p className={styles.sectorRaised}>{formatUsd(stat.totalRaisedUsd)}</p>
              <div className={styles.sectorMeta}>
                <span>{formatCount(stat.dealCount)} deals</span>
                <span
                  className={stat.trendPct >= 0 ? styles.trendUp : styles.trendDown}
                >
                  {signedPct(stat.trendPct)}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <SectionHeader title="Companies" note={`${companies.length} profiles`} />

        <div className={styles.table} role="table" aria-label="Company directory">
          <div className={`${styles.row} ${styles.rowHead}`} role="row">
            <span role="columnheader">Company</span>
            <span role="columnheader">Stage</span>
            <span role="columnheader" className={styles.num}>
              Last valuation
            </span>
            <span role="columnheader" className={styles.num}>
              Total raised
            </span>
          </div>

          {companies.map((company) => (
            <Link
              key={company.slug}
              href={`/companies/${company.slug}`}
              className={styles.row}
              role="row"
            >
              <span className={styles.company} role="cell">
                <CompanyLogo name={company.name} domain={company.domain} size={40} />
                <span className={styles.companyText}>
                  <span className={styles.companyName}>{company.name}</span>
                  <span className={styles.companyLine}>{company.oneLiner}</span>
                </span>
              </span>
              <span className={styles.stage} role="cell">
                <Tag variant="pill">{company.stage}</Tag>
                <span className={styles.sectorTag}>
                  {company.primarySector ?? company.industry[0]}
                </span>
              </span>
              <span className={`${styles.num} ${styles.valuation}`} role="cell">
                {formatUsd(company.lastValuationUsd)}
              </span>
              <span className={`${styles.num} ${styles.raised}`} role="cell">
                {formatUsd(company.totalRaisedUsd)}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Capbase · open company and funding data</span>
        <span className={styles.footerNote}>
          Figures shown are illustrative demo data.
        </span>
      </footer>
    </main>
  );
}
