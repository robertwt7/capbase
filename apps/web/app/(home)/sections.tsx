import { CONTRIBUTION_WINDOW_DAYS, PREVIEW_LIMIT } from '@repo/api';
import Link from 'next/link';
import { cache, type ReactNode } from 'react';

import { COMPANY_COLUMNS, CompanyTable } from '@/components/CompanyTable';
import { StatsSkeleton, TableSkeleton } from '@/components/skeletons';
import { Button, Card, Eyebrow, SectionHeader, Skeleton, Stat } from '@/components/ui';
import { getToken } from '@/lib/auth';
import { getFeaturedCompanies, getMarketStats, getMarketTotals } from '@/lib/data';
import { formatCount, formatCountCompact, formatDate, formatUsd, signedPct } from '@/lib/format';
import { sectorSlug } from '@/lib/markets';

/** Featured rows fetched; the first HOME_OPEN are shown, the rest blurred
    behind the contribution gate for a viewer who hasn't unlocked. */
const HOME_FEATURED = 10;
const HOME_OPEN = 5;
const HOME_SECTORS = 5;

const STEPS = [
  {
    title: 'Browse for free',
    body: `Every company, investor, fund and person is open to search. Profiles show the first ${PREVIEW_LIMIT} rows of each section — rounds, investors, people — to everyone.`,
  },
  {
    title: 'Contribute a fact',
    body: 'Add a funding round, a founder, an investor or a correction, with a source. A moderator reviews every submission before it goes live.',
  },
  {
    title: 'Unlock everything',
    body: `Once a contribution is accepted, every profile opens in full — complete funding histories, every investor, every person — for ${CONTRIBUTION_WINDOW_DAYS} days.`,
  },
] as const;

/** One featured draw per request, shared by AccessNote and PopularCompanies —
    two calls would also be two different random samples. Landing shop window:
    a fresh random draw from the most popular companies, not the head of an
    alphabetical (or raised-desc) directory. */
const loadFeatured = cache(() => getFeaturedCompanies(HOME_FEATURED));

// ---------------------------------------------------------------------------
// Hero + stat strip

/** The static hero. `children` is the stat strip, so it stays inside the hero
    section with its current spacing whether streamed or still a skeleton. */
export function HomeHero({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto max-w-(--page-max) px-(--page-pad) pt-20">
      <div className="max-w-3xl">
        <Eyebrow>Open private-market data</Eyebrow>
        <h1 className="mt-5 font-display text-[clamp(2.25rem,5.4vw,4rem)] leading-[1.02] font-extrabold tracking-[-0.035em] text-ink">
          Private market data, open to everyone.
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-graphite-700">
          Search companies, funding rounds, investors, funds and the people behind them —
          built from SEC filings and public records, with a source on every fact. The free
          alternative to Crunchbase and PitchBook.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button variant="primary" shape="pill" href="/companies">
            Explore the data
          </Button>
          <Button variant="outline" shape="pill" href="/contribute">
            Contribute a company
          </Button>
        </div>
      </div>

      {children}
    </section>
  );
}

const STAT_STRIP =
  'mt-12 flex flex-wrap gap-x-14 gap-y-3 border-t border-b border-t-ink border-b-line py-7';

export async function StatStrip() {
  const marketTotals = await getMarketTotals();
  return (
    <div className={STAT_STRIP} aria-label="What Capbase covers">
      <Stat size="lg" label="Companies" value={formatCountCompact(marketTotals.companyCount)} />
      <Stat size="lg" label="Deals" value={formatCountCompact(marketTotals.dealCount)} />
      <Stat size="lg" label="Investors" value={formatCountCompact(marketTotals.investorCount)} />
      <Stat size="lg" label="Funds" value={formatCountCompact(marketTotals.fundCount)} />
      <Stat size="lg" label="People" value={formatCountCompact(marketTotals.personCount)} />
    </div>
  );
}

export function StatStripSkeleton() {
  return (
    <div className={STAT_STRIP}>
      <StatsSkeleton count={5} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// How it works

/** `note` is the viewer's access line (streamed, `AccessNote`), or nothing. */
export function HowItWorks({ note }: { note?: ReactNode }) {
  return (
    <section
      id="how-it-works"
      className="mx-auto max-w-(--page-max) scroll-mt-24 px-(--page-pad) pt-16"
    >
      <SectionHeader title="How it works" note={note} />
      <ol className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line max-[900px]:grid-cols-1">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex flex-col gap-2.5 bg-surface p-[22px]">
            <span className="font-mono text-xs tracking-[0.14em] text-graphite-500">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3 className="font-display text-lg font-semibold tracking-tight text-ink">
              {step.title}
            </h3>
            <p className="text-sm leading-relaxed text-graphite-700">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** "Full access until …" for an unlocked viewer; nothing for a locked one. */
export async function AccessNote() {
  const { access } = await loadFeatured();
  if (!access.unlocked) return null;
  return (
    <span className="font-mono text-xs text-graphite-500 uppercase">
      {access.unlockedUntil
        ? `Full access until ${formatDate(access.unlockedUntil)}`
        : 'Full access'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Top sectors

const SECTOR_GRID =
  'mt-6 grid grid-cols-5 gap-px overflow-hidden rounded-xl border border-line bg-line max-[900px]:grid-cols-2';

export function TopSectorsSection({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto max-w-(--page-max) px-(--page-pad) pt-16">
      <SectionHeader
        title="Top sectors"
        note={
          <Button variant="ghost" size="sm" href="/markets">
            All markets →
          </Button>
        }
      />
      {children}
    </section>
  );
}

export async function TopSectors() {
  const marketStats = await getMarketStats();
  return (
    <div className={SECTOR_GRID}>
      {marketStats.slice(0, HOME_SECTORS).map((stat) => (
        <Link
          key={stat.sector}
          href={`/markets/${sectorSlug(stat.sector)}`}
          className="flex flex-col gap-2.5 bg-surface p-[18px] transition-colors hover:bg-paper"
        >
          <h3 className="min-h-[2.6em] text-[13px] font-medium text-graphite-700 max-[900px]:min-h-0">
            {stat.sector}
          </h3>
          <p className="font-mono text-[22px] font-medium tracking-tight text-ink">
            {formatUsd(stat.totalRaisedUsd)}
          </p>
          <div className="flex items-baseline justify-between font-mono text-xs text-graphite-500">
            <span>{formatCount(stat.dealCount)} deals</span>
            <span className={stat.trendPct >= 0 ? 'text-ink' : 'text-graphite-400'}>
              {signedPct(stat.trendPct)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/** Same cells as TopSectors, each bar in a slot of the real line height. */
export function TopSectorsSkeleton() {
  return (
    <div className={SECTOR_GRID} aria-hidden="true">
      {Array.from({ length: HOME_SECTORS }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5 bg-surface p-[18px]">
          <span className="min-h-[2.6em] text-[13px] max-[900px]:min-h-0">
            <span className="flex h-[1.5em] items-center">
              <Skeleton className={i % 2 ? 'h-3 w-20' : 'h-3 w-28'} />
            </span>
          </span>
          <span className="flex h-[33px] items-center">
            <Skeleton className="h-6 w-24" />
          </span>
          <span className="flex h-[18px] items-center justify-between">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-2.5 w-10" />
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Popular companies

export function PopularCompaniesSection({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto max-w-(--page-max) px-(--page-pad) pt-16">
      <SectionHeader
        title="Popular companies"
        note={
          <Button variant="ghost" size="sm" href="/companies">
            View all companies →
          </Button>
        }
      />
      <div className="mt-6">{children}</div>
    </section>
  );
}

export async function PopularCompanies() {
  const [{ items: featured, access }, token] = await Promise.all([loadFeatured(), getToken()]);
  const open = access.unlocked ? featured : featured.slice(0, HOME_OPEN);
  const gated = access.unlocked ? [] : featured.slice(HOME_OPEN);

  return (
    <CompanyTable
      companies={open}
      locked={
        gated.length > 0
          ? { companies: gated, overlay: <UnlockPanel signedIn={Boolean(token)} /> }
          : undefined
      }
    />
  );
}

export function PopularCompaniesSkeleton() {
  return (
    <TableSkeleton
      cols={COMPANY_COLUMNS}
      cells={['left', 'right', 'right']}
      rows={HOME_FEATURED}
      logo
      collapseAt={700}
    />
  );
}

/** The overlay on the blurred half of the landing company list. */
function UnlockPanel({ signedIn }: { signedIn: boolean }) {
  return (
    <Card emphasis className="w-full max-w-md p-6 text-center">
      <Eyebrow>Contributor access</Eyebrow>
      <p className="mt-3 font-display text-xl font-semibold tracking-tight text-ink">
        Unlock by contributing accepted data
      </p>
      <p className="mt-2 text-sm leading-relaxed text-graphite-700">
        One approved contribution opens every profile in full — every round, investor and person
        — for {CONTRIBUTION_WINDOW_DAYS} days.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {signedIn ? (
          <Button variant="primary" shape="pill" size="sm" href="/contribute">
            Contribute data
          </Button>
        ) : (
          <>
            <Button variant="primary" shape="pill" size="sm" href="/register?next=/contribute">
              Create a free account
            </Button>
            <Button variant="outline" shape="pill" size="sm" href="/login?next=/contribute">
              Sign in
            </Button>
          </>
        )}
        <Button variant="ghost" shape="pill" size="sm" href="#how-it-works">
          How it works
        </Button>
      </div>
    </Card>
  );
}
