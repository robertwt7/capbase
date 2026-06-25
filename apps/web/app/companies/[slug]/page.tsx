import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CompanyAccess } from '@repo/api';

import { AddRoundForm } from './AddRoundForm';
import { CompanyLogo } from '../../../components/CompanyLogo';
import { FundingLadder } from '../../../components/FundingLadder';
import { getSession } from '../../../lib/auth';
import { getCompanyDetail } from '../../../lib/data';
import { formatCount, formatDate, formatUsd, signedPct } from '../../../lib/format';

import styles from './profile.module.css';

export default async function CompanyProfile({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [result, session] = await Promise.all([getCompanyDetail(slug), getSession()]);

  if (!result) {
    notFound();
  }

  const { company, access } = result;
  const signedIn = session !== null;

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
          {(company.websiteUrl || company.linkedinUrl || company.twitterUrl) && (
            <div className={styles.links}>
              {company.websiteUrl && (
                <OutboundLink href={company.websiteUrl}>Website</OutboundLink>
              )}
              {company.linkedinUrl && (
                <OutboundLink href={company.linkedinUrl}>LinkedIn</OutboundLink>
              )}
              {company.twitterUrl && (
                <OutboundLink href={company.twitterUrl}>Twitter</OutboundLink>
              )}
            </div>
          )}
        </div>
        <dl className={styles.facts}>
          <Fact label="Founded" value={company.founded.toString()} />
          <Fact label="Headquarters" value={company.hq} />
          <Fact label="Headcount" value={formatCount(company.headcount)} />
          <Fact label="Stage" value={company.stage} />
          {company.primarySector && <Fact label="Sector" value={company.primarySector} />}
          {company.legalName && <Fact label="Legal name" value={company.legalName} />}
          {company.operatingStatus && (
            <Fact label="Operating status" value={company.operatingStatus} />
          )}
          {company.companyType && <Fact label="Company type" value={company.companyType} />}
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

      <Block
        title="Funding rounds"
        note={access.totals.rounds > 0 ? `${access.totals.rounds} rounds` : undefined}
      >
        {company.rounds && company.rounds.length > 0 ? (
          <FundingLadder rounds={company.rounds} />
        ) : (
          <Empty action="Add a funding round">
            No rounds recorded yet for {company.name}.
          </Empty>
        )}
        <LockNote shown={company.rounds?.length ?? 0} total={access.totals.rounds} access={access} slug={company.slug} signedIn={signedIn} />
        {signedIn ? <AddRoundForm slug={company.slug} /> : null}
      </Block>

      <Block
        title="Investors"
        note={access.totals.investors > 0 ? `${access.totals.investors} on file` : undefined}
      >
        {company.investors && company.investors.length > 0 ? (
          <div className={styles.investors}>
            {company.investors.map((inv) => (
              <div key={inv.name} className={styles.investor}>
                {inv.websiteUrl || inv.linkedinUrl ? (
                  <a
                    href={(inv.websiteUrl ?? inv.linkedinUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.investorLink}
                  >
                    {inv.name}
                  </a>
                ) : (
                  <span className={styles.investorName}>{inv.name}</span>
                )}
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
        <LockNote shown={company.investors?.length ?? 0} total={access.totals.investors} access={access} slug={company.slug} signedIn={signedIn} />
      </Block>

      <Block title="People" note={access.totals.people > 0 ? 'Leadership' : undefined}>
        {company.people && company.people.length > 0 ? (
          <div className={styles.people}>
            {company.people.map((person) => (
              <div key={person.name} className={styles.person}>
                <span className={styles.personName}>{person.name}</span>
                <span className={styles.personRole}>
                  {person.role}
                  {person.title && person.title !== person.role ? ` · ${person.title}` : ''}
                </span>
                <span className={styles.personMeta}>
                  Since {person.since}
                  {person.prior ? ` · prev. ${person.prior}` : ''}
                </span>
                {person.linkedinUrl && (
                  <OutboundLink href={person.linkedinUrl}>LinkedIn</OutboundLink>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty action="Add a team member">
            No people recorded yet for {company.name}.
          </Empty>
        )}
        <LockNote shown={company.people?.length ?? 0} total={access.totals.people} access={access} slug={company.slug} signedIn={signedIn} />
      </Block>

      <div className={styles.dealGrid}>
        <Block
          title="Acquisitions"
          note={access.totals.acquisitions > 0 ? `${access.totals.acquisitions} deals` : undefined}
        >
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
          <LockNote shown={company.acquisitions?.length ?? 0} total={access.totals.acquisitions} access={access} slug={company.slug} signedIn={signedIn} />
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
          <LockNote shown={company.exits?.length ?? 0} total={access.totals.exits} access={access} slug={company.slug} signedIn={signedIn} />
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
        <LockNote shown={company.diversity?.length ?? 0} total={access.totals.diversity} access={access} slug={company.slug} signedIn={signedIn} />
      </Block>

      <footer className={styles.footer}>
        Figures shown are illustrative demo data, pending live ingestion.
      </footer>
    </main>
  );
}

function LockNote({
  shown,
  total,
  access,
  slug,
  signedIn,
}: {
  shown: number;
  total: number;
  access: CompanyAccess;
  slug: string;
  signedIn: boolean;
}) {
  // Only shown when the viewer is locked and there is hidden data beyond the preview.
  if (access.unlocked || total <= shown) return null;
  return (
    <div className={styles.lockNote}>
      <span className={styles.lockText}>
        Showing <span className={styles.lockCount}>{shown}</span> of{' '}
        <span className={styles.lockCount}>{total}</span> — contribute to unlock the rest.
      </span>
      <Link
        href={signedIn ? '/contribute' : `/login?next=${encodeURIComponent(`/companies/${slug}`)}`}
        className={styles.lockAction}
      >
        {signedIn ? 'Contribute to unlock' : 'Sign in to unlock'}
      </Link>
    </div>
  );
}

function OutboundLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={styles.outLink}>
      {children}
    </a>
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
