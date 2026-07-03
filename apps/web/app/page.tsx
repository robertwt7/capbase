import Link from 'next/link';

import { CompanyTable } from '@/components/CompanyTable';
import { Button, Eyebrow, SectionHeader, Stat } from '@/components/ui';
import { getCompanies, getMarketStats, getMarketTotals } from '@/lib/data';
import { formatCount, formatUsd, signedPct } from '@/lib/format';
import { sectorSlug } from '@/lib/markets';

const HOME_PREVIEW = 8;

export default async function Home() {
  const [companies, marketStats, marketTotals] = await Promise.all([
    getCompanies(),
    getMarketStats(),
    getMarketTotals(),
  ]);

  return (
    <main>
      <section className="mx-auto max-w-(--page-max) px-(--page-pad) pt-20">
        <div className="max-w-3xl">
          <Eyebrow>{marketTotals.quarter} · private market intelligence</Eyebrow>
          <h1 className="mt-5 font-display text-[clamp(2.25rem,5.4vw,4rem)] leading-[1.02] font-extrabold tracking-[-0.035em] text-ink">
            The cap table of the private economy, in the open.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-graphite-700">
            Funding rounds, investors, people, and exits for the companies shaping each sector —
            sourced openly, free to read, free to build on.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button variant="primary" shape="pill" href="/companies">
              Browse companies
            </Button>
            <Button variant="outline" shape="pill" href="/contribute">
              Contribute a company
            </Button>
          </div>
        </div>

        <div
          className="mt-12 flex flex-wrap gap-x-14 gap-y-3 border-t border-b border-t-ink border-b-line py-7"
          aria-label={`${marketTotals.quarter} market totals`}
        >
          <Stat size="lg" label="Capital deployed" value={formatUsd(marketTotals.totalRaisedUsd)} />
          <Stat size="lg" label="Disclosed deals" value={formatCount(marketTotals.dealCount)} />
          <Stat size="lg" label="New unicorns" value={formatCount(marketTotals.newUnicorns)} />
        </div>
      </section>

      <section className="mx-auto max-w-(--page-max) px-(--page-pad) pt-16">
        <SectionHeader title="Sectors this quarter" note="Deal volume vs. prior quarter" />
        <div className="mt-6 grid grid-cols-5 gap-px overflow-hidden rounded-xl border border-line bg-line max-[900px]:grid-cols-2">
          {marketStats.map((stat) => (
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
      </section>

      <section className="mx-auto max-w-(--page-max) px-(--page-pad) pt-16">
        <SectionHeader
          title="Companies"
          note={
            <Button variant="ghost" size="sm" href="/companies">
              View all companies →
            </Button>
          }
        />

        <div className="mt-6">
          <CompanyTable companies={companies.slice(0, HOME_PREVIEW)} />
        </div>
      </section>

      <footer className="mx-auto mt-20 flex max-w-(--page-max) flex-wrap justify-between gap-4 border-t border-line px-(--page-pad) py-7 text-[13px] text-graphite-500">
        <span>Capbase · open company and funding data</span>
        <span className="font-mono text-xs">Figures shown are illustrative demo data.</span>
      </footer>
    </main>
  );
}
