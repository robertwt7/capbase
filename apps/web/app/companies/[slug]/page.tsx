import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CompanyAccess } from '@repo/api';

import { CompanyLogo } from '@/components/CompanyLogo';
import { FundingLadder } from '@/components/FundingLadder';
import { Button, EmptyState, SectionHeader, Stat, Tag } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { getCompanyDetail } from '@/lib/data';
import { formatCount, formatDate, formatUsd, signedPct } from '@/lib/format';

import { AddRoundForm } from './AddRoundForm';

const panel = 'grid gap-px overflow-hidden rounded-[10px] border border-line bg-line';
const cell = 'bg-surface';

export default async function CompanyProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [result, session] = await Promise.all([getCompanyDetail(slug), getSession()]);

  if (!result) {
    notFound();
  }

  const { company, access } = result;
  const signedIn = session !== null;

  return (
    <main className="mx-auto max-w-(--page-max) px-(--page-pad) pt-8">
      <Link
        href="/"
        className="font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
      >
        ← All companies
      </Link>

      <header className="grid grid-cols-[auto_1fr_auto] items-start gap-7 border-b border-ink pt-7 pb-9 max-[860px]:grid-cols-[auto_1fr] max-[600px]:grid-cols-1">
        <CompanyLogo name={company.name} domain={company.domain} size={72} />
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            <h1 className="font-display text-[clamp(1.875rem,4vw,2.75rem)] leading-none font-extrabold tracking-[-0.035em] text-ink">
              {company.name}
            </h1>
            <Tag variant="pill" mono>
              {company.status}
            </Tag>
          </div>
          <p className="mt-3 max-w-[48ch] text-[17px] text-graphite-700">{company.oneLiner}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {company.industry.map((tag) => (
              <Tag key={tag} variant="box">
                {tag}
              </Tag>
            ))}
          </div>
          {(company.websiteUrl || company.linkedinUrl || company.twitterUrl) && (
            <div className="mt-4 flex flex-wrap gap-4">
              {company.websiteUrl && <OutboundLink href={company.websiteUrl}>Website</OutboundLink>}
              {company.linkedinUrl && (
                <OutboundLink href={company.linkedinUrl}>LinkedIn</OutboundLink>
              )}
              {company.twitterUrl && <OutboundLink href={company.twitterUrl}>Twitter</OutboundLink>}
            </div>
          )}
        </div>
        <dl className="grid grid-cols-[repeat(2,auto)] gap-x-8 gap-y-4 max-[860px]:col-span-full max-[860px]:grid-cols-[repeat(4,auto)] max-[860px]:justify-start max-[600px]:grid-cols-[repeat(2,auto)]">
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

      <section className="flex flex-wrap gap-x-16 gap-y-3.5 border-b border-line py-8">
        <Stat label="Total raised" value={formatUsd(company.totalRaisedUsd)} />
        <Stat label="Last valuation" value={formatUsd(company.lastValuationUsd)} />
        {company.financials && (
          <>
            <Stat label="Revenue (est.)" value={formatUsd(company.financials.revenueUsd)} />
            <Stat label="Revenue growth" value={signedPct(company.financials.revenueGrowthPct)} />
            <Stat label="Gross margin" value={`${company.financials.grossMarginPct}%`} />
          </>
        )}
      </section>

      <section className="max-w-[70ch] py-9">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink">Overview</h2>
        <p className="mt-3 text-base leading-[1.65] text-graphite-900">{company.description}</p>
      </section>

      <Block
        title="Funding rounds"
        note={access.totals.rounds > 0 ? `${access.totals.rounds} rounds` : undefined}
      >
        {company.rounds && company.rounds.length > 0 ? (
          <FundingLadder rounds={company.rounds} />
        ) : (
          <Empty action="Add a funding round">No rounds recorded yet for {company.name}.</Empty>
        )}
        <LockNote
          shown={company.rounds?.length ?? 0}
          total={access.totals.rounds}
          access={access}
          slug={company.slug}
          signedIn={signedIn}
        />
        {signedIn ? (
          <div className="mt-4">
            <AddRoundForm slug={company.slug} />
          </div>
        ) : null}
      </Block>

      <Block
        title="Investors"
        note={access.totals.investors > 0 ? `${access.totals.investors} on file` : undefined}
      >
        {company.investors && company.investors.length > 0 ? (
          <div className={`${panel} grid-cols-2 max-[600px]:grid-cols-1`}>
            {company.investors.map((inv) => (
              <div
                key={inv.name}
                className={`${cell} grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1 px-[18px] py-4`}
              >
                {inv.websiteUrl || inv.linkedinUrl ? (
                  <a
                    href={(inv.websiteUrl ?? inv.linkedinUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-display text-[15px] font-semibold text-ink underline underline-offset-[3px] hover:text-graphite-700"
                  >
                    {inv.name}
                  </a>
                ) : (
                  <span className="font-display text-[15px] font-semibold text-ink">{inv.name}</span>
                )}
                <span className="text-right font-mono text-[11px] tracking-[0.04em] text-graphite-500 uppercase">
                  {inv.type}
                </span>
                <span className="col-span-full text-[13px] text-graphite-500">
                  {inv.rounds} {inv.rounds === 1 ? 'round' : 'rounds'} · since {inv.firstRound}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty action="Add an investor">No investors recorded yet for {company.name}.</Empty>
        )}
        <LockNote
          shown={company.investors?.length ?? 0}
          total={access.totals.investors}
          access={access}
          slug={company.slug}
          signedIn={signedIn}
        />
      </Block>

      <Block title="People" note={access.totals.people > 0 ? 'Leadership' : undefined}>
        {company.people && company.people.length > 0 ? (
          <div className={`${panel} grid-cols-3 max-[860px]:grid-cols-1`}>
            {company.people.map((person) => (
              <div key={person.name} className={`${cell} flex flex-col gap-1 p-[18px]`}>
                <span className="font-display text-[15px] font-semibold text-ink">
                  {person.name}
                </span>
                <span className="text-[13px] text-graphite-700">
                  {person.role}
                  {person.title && person.title !== person.role ? ` · ${person.title}` : ''}
                </span>
                <span className="mt-1 font-mono text-xs text-graphite-500">
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
          <Empty action="Add a team member">No people recorded yet for {company.name}.</Empty>
        )}
        <LockNote
          shown={company.people?.length ?? 0}
          total={access.totals.people}
          access={access}
          slug={company.slug}
          signedIn={signedIn}
        />
      </Block>

      <div className="grid grid-cols-2 gap-10 max-[860px]:grid-cols-1 max-[860px]:gap-0">
        <Block
          title="Acquisitions"
          note={access.totals.acquisitions > 0 ? `${access.totals.acquisitions} deals` : undefined}
        >
          {company.acquisitions && company.acquisitions.length > 0 ? (
            <ul className={`${panel} grid-cols-1`}>
              {company.acquisitions.map((deal) => (
                <Deal
                  key={deal.target}
                  name={deal.target}
                  amount={formatUsd(deal.amountUsd)}
                  date={formatDate(deal.date)}
                  note={deal.rationale}
                />
              ))}
            </ul>
          ) : (
            <Empty action="Add an acquisition">{company.name} has no recorded acquisitions.</Empty>
          )}
          <LockNote
            shown={company.acquisitions?.length ?? 0}
            total={access.totals.acquisitions}
            access={access}
            slug={company.slug}
            signedIn={signedIn}
          />
        </Block>

        <Block title="Exits">
          {company.exits && company.exits.length > 0 ? (
            <ul className={`${panel} grid-cols-1`}>
              {company.exits.map((exit, i) => (
                <Deal
                  key={i}
                  name={exit.type}
                  amount={formatUsd(exit.valueUsd)}
                  date={formatDate(exit.date)}
                  note={exit.detail}
                />
              ))}
            </ul>
          ) : (
            <Empty>Still private — no exit on record.</Empty>
          )}
          <LockNote
            shown={company.exits?.length ?? 0}
            total={access.totals.exits}
            access={access}
            slug={company.slug}
            signedIn={signedIn}
          />
        </Block>
      </div>

      <Block title="Diversity investments">
        {company.diversity && company.diversity.length > 0 ? (
          <div className={`${panel} grid-cols-3 max-[860px]:grid-cols-1`}>
            {company.diversity.map((d) => (
              <div key={d.label} className={`${cell} flex flex-col gap-1.5 px-[18px] py-5`}>
                <span className="font-mono text-2xl font-medium tracking-tight text-ink">
                  {d.value}
                </span>
                <span className="text-[13px] font-medium text-graphite-900">{d.label}</span>
                <span className="text-xs text-graphite-500">{d.note}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty action="Add diversity data">
            No diversity signals recorded yet for {company.name}.
          </Empty>
        )}
        <LockNote
          shown={company.diversity?.length ?? 0}
          total={access.totals.diversity}
          access={access}
          slug={company.slug}
          signedIn={signedIn}
        />
      </Block>

      <footer className="mt-6 border-t border-line pt-7 pb-16 font-mono text-xs text-graphite-500">
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
    <div className="mt-3.5 flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-dashed border-graphite-300 bg-paper px-[18px] py-3.5">
      <span className="font-sans text-[13px] text-graphite-700">
        Showing <span className="font-mono text-ink">{shown}</span> of{' '}
        <span className="font-mono text-ink">{total}</span> — contribute to unlock the rest.
      </span>
      <Button
        variant="primary"
        shape="pill"
        size="sm"
        href={signedIn ? '/contribute' : `/login?next=${encodeURIComponent(`/companies/${slug}`)}`}
      >
        {signedIn ? 'Contribute to unlock' : 'Sign in to unlock'}
      </Button>
    </div>
  );
}

function OutboundLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs tracking-[0.02em] text-graphite-700 underline underline-offset-[3px] transition-colors hover:text-ink"
    >
      {children}
    </a>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] tracking-[0.04em] text-graphite-500 uppercase">{label}</dt>
      <dd className="font-mono text-sm text-ink">{value}</dd>
    </div>
  );
}

function Deal({
  name,
  amount,
  date,
  note,
}: {
  name: string;
  amount: string;
  date: string;
  note: string;
}) {
  return (
    <li className={`${cell} flex flex-col gap-1 px-[18px] py-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-[15px] font-semibold text-ink">{name}</span>
        <span className="font-mono text-sm text-ink">{amount}</span>
      </div>
      <span className="font-mono text-xs text-graphite-500">{date}</span>
      <p className="mt-0.5 text-[13px] text-graphite-700">{note}</p>
    </li>
  );
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
    <section className="border-t border-line py-8">
      <SectionHeader title={title} note={note} size="md" className="mb-5 border-b-0 pb-0" />
      {children}
    </section>
  );
}

function Empty({ children, action }: { children: React.ReactNode; action?: string }) {
  return (
    <EmptyState
      action={
        action ? (
          <Button variant="outline" shape="pill" size="sm">
            {action}
          </Button>
        ) : undefined
      }
    >
      {children}
    </EmptyState>
  );
}
