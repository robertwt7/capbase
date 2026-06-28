import Link from 'next/link';

import { CompanyLogo } from '@/components/CompanyLogo';
import { Badge, Button, Eyebrow, SectionHeader, Stat } from '@/components/ui';
import { getCompanies, getMarketStats, getMarketTotals } from '@/lib/data';
import { formatCount, formatUsd, signedPct } from '@/lib/format';

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
            <Button variant="primary" shape="pill" href="#companies">
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
            <article key={stat.sector} className="flex flex-col gap-2.5 bg-surface p-[18px]">
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
            </article>
          ))}
        </div>
      </section>

      <section id="companies" className="mx-auto max-w-(--page-max) scroll-mt-20 px-(--page-pad) pt-16">
        <SectionHeader title="Companies" note={`${companies.length} profiles`} />

        <div
          className="mt-6 overflow-hidden rounded-xl border border-line"
          role="table"
          aria-label="Company directory"
        >
          <div
            className="grid grid-cols-[minmax(0,2.6fr)_1.1fr_1fr_1fr] items-center gap-5 bg-paper px-[22px] py-3 font-mono text-[11px] tracking-[0.05em] text-graphite-500 uppercase max-[700px]:hidden"
            role="row"
          >
            <span role="columnheader">Company</span>
            <span role="columnheader">Stage</span>
            <span role="columnheader" className="text-right">
              Last valuation
            </span>
            <span role="columnheader" className="text-right">
              Total raised
            </span>
          </div>

          {companies.map((company) => (
            <Link
              key={company.slug}
              href={`/companies/${company.slug}`}
              className="grid grid-cols-[minmax(0,2.6fr)_1.1fr_1fr_1fr] items-center gap-5 border-t border-line px-[22px] py-4 transition-colors hover:bg-paper max-[700px]:grid-cols-[1fr_auto] max-[700px]:gap-y-3"
              role="row"
            >
              <span className="flex min-w-0 items-center gap-3.5" role="cell">
                <CompanyLogo name={company.name} domain={company.domain} size={40} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-display text-base font-semibold tracking-tight text-ink">
                    {company.name}
                  </span>
                  <span className="truncate text-[13px] text-graphite-500">{company.oneLiner}</span>
                </span>
              </span>
              <span
                className="flex flex-col items-start gap-1.5 max-[700px]:flex-row max-[700px]:items-center max-[700px]:gap-2"
                role="cell"
              >
                <Badge variant="pill">{company.stage}</Badge>
                <span className="text-xs text-graphite-500">
                  {company.primarySector ?? company.industry[0]}
                </span>
              </span>
              <span
                className="text-right font-mono text-base font-medium text-ink max-[700px]:col-start-1 max-[700px]:text-left"
                role="cell"
              >
                {formatUsd(company.lastValuationUsd)}
              </span>
              <span
                className="text-right font-mono text-[15px] text-graphite-700 max-[700px]:col-start-1 max-[700px]:text-left"
                role="cell"
              >
                {formatUsd(company.totalRaisedUsd)}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <footer className="mx-auto mt-20 flex max-w-(--page-max) flex-wrap justify-between gap-4 border-t border-line px-(--page-pad) py-7 text-[13px] text-graphite-500">
        <span>Capbase · open company and funding data</span>
        <span className="font-mono text-xs">Figures shown are illustrative demo data.</span>
      </footer>
    </main>
  );
}
