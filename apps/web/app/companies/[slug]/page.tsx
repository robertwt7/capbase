import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CompanyLogo } from '../../../components/CompanyLogo';
import { FundingLadder } from '../../../components/FundingLadder';
import { getCompany } from '../../../lib/data';
import { formatCount, formatDate, formatUsd, signedPct } from '../../../lib/format';

import styles from './profile.module.css';

export default async function CompanyProfile({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const company = await getCompany(slug);

  if (!company) {
    notFound();
  }

  return (
    <main className={styles.page}>
      <Link href="/" className={styles.back}>
        ← All companies
      </Link>

      <header className={styles.header}>
        <CompanyLogo name={company.name} domain={company.domain} size={72} />
        <div className={styles.headerBody}>
          <div className={styles.titleRow}>
            <h1 className={styles.name}>{company.name}</h1>
            <span className={styles.status}>{company.status}</span>
          </div>
          <p className={styles.oneLiner}>{company.oneLiner}</p>
          <div className={styles.tags}>
            {company.industry.map((tag) => (
              <span key={tag} className={styles.tag}>
                {tag}
              </span>
            ))}
          </div>
        </div>
        <dl className={styles.facts}>
          <Fact label="Founded" value={company.founded.toString()} />
          <Fact label="Headquarters" value={company.hq} />
          <Fact label="Headcount" value={formatCount(company.headcount)} />
          <Fact label="Stage" value={company.stage} />
        </dl>
      </header>

      <section className={styles.statBand}>
        <Stat label="Total raised" value={formatUsd(company.totalRaisedUsd)} />
        <Stat label="Last valuation" value={formatUsd(company.lastValuationUsd)} />
        {company.financials && (
          <>
            <Stat label="Revenue (est.)" value={formatUsd(company.financials.revenueUsd)} />
            <Stat
              label="Revenue growth"
              value={signedPct(company.financials.revenueGrowthPct)}
            />
            <Stat label="Gross margin" value={`${company.financials.grossMarginPct}%`} />
          </>
        )}
      </section>

      <section className={styles.about}>
        <SectionTitle>Overview</SectionTitle>
        <p className={styles.aboutText}>{company.description}</p>
      </section>

      <Block title="Funding rounds" note={company.rounds ? `${company.rounds.length} rounds` : undefined}>
        {company.rounds ? (
          <FundingLadder rounds={company.rounds} />
        ) : (
          <Empty action="Add a funding round">
            No rounds recorded yet for {company.name}.
          </Empty>
        )}
      </Block>

      <Block title="Investors" note={company.investors ? `${company.investors.length} on file` : undefined}>
        {company.investors ? (
          <div className={styles.investors}>
            {company.investors.map((inv) => (
              <div key={inv.name} className={styles.investor}>
                <span className={styles.investorName}>{inv.name}</span>
                <span className={styles.investorType}>{inv.type}</span>
                <span className={styles.investorRounds}>
                  {inv.rounds} {inv.rounds === 1 ? 'round' : 'rounds'} · since {inv.firstRound}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty action="Add an investor">
            No investors recorded yet for {company.name}.
          </Empty>
        )}
      </Block>

      <Block title="People" note={company.people ? 'Leadership' : undefined}>
        {company.people ? (
          <div className={styles.people}>
            {company.people.map((person) => (
              <div key={person.name} className={styles.person}>
                <span className={styles.personName}>{person.name}</span>
                <span className={styles.personRole}>{person.role}</span>
                <span className={styles.personMeta}>
                  Since {person.since}
                  {person.prior ? ` · prev. ${person.prior}` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty action="Add a team member">
            No people recorded yet for {company.name}.
          </Empty>
        )}
      </Block>

      <div className={styles.dealGrid}>
        <Block title="Acquisitions" note={company.acquisitions ? `${company.acquisitions.length} deals` : undefined}>
          {company.acquisitions && company.acquisitions.length > 0 ? (
            <ul className={styles.deals}>
              {company.acquisitions.map((deal) => (
                <li key={deal.target} className={styles.deal}>
                  <div className={styles.dealTop}>
                    <span className={styles.dealName}>{deal.target}</span>
                    <span className={styles.dealAmount}>{formatUsd(deal.amountUsd)}</span>
                  </div>
                  <span className={styles.dealDate}>{formatDate(deal.date)}</span>
                  <p className={styles.dealNote}>{deal.rationale}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty action="Add an acquisition">
              {company.name} has no recorded acquisitions.
            </Empty>
          )}
        </Block>

        <Block title="Exits">
          {company.exits && company.exits.length > 0 ? (
            <ul className={styles.deals}>
              {company.exits.map((exit, i) => (
                <li key={i} className={styles.deal}>
                  <div className={styles.dealTop}>
                    <span className={styles.dealName}>{exit.type}</span>
                    <span className={styles.dealAmount}>{formatUsd(exit.valueUsd)}</span>
                  </div>
                  <span className={styles.dealDate}>{formatDate(exit.date)}</span>
                  <p className={styles.dealNote}>{exit.detail}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Still private — no exit on record.</Empty>
          )}
        </Block>
      </div>

      <Block title="Diversity investments">
        {company.diversity && company.diversity.length > 0 ? (
          <div className={styles.diversity}>
            {company.diversity.map((d) => (
              <div key={d.label} className={styles.diversityItem}>
                <span className={styles.diversityValue}>{d.value}</span>
                <span className={styles.diversityLabel}>{d.label}</span>
                <span className={styles.diversityNote}>{d.note}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty action="Add diversity data">
            No diversity signals recorded yet for {company.name}.
          </Empty>
        )}
      </Block>

      <footer className={styles.footer}>
        Figures shown are illustrative demo data, pending live ingestion.
      </footer>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className={styles.blockTitle}>{children}</h2>;
}

function Block({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <h2 className={styles.blockTitle}>{title}</h2>
        {note && <span className={styles.blockNote}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: string;
}) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyText}>{children}</p>
      {action && (
        <button type="button" className={styles.emptyAction}>
          {action}
        </button>
      )}
    </div>
  );
}
