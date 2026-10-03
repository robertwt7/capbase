import Link from 'next/link';

import { CompanyTable } from '@/components/CompanyTable';
import { JsonLd } from '@/components/JsonLd';
import { Button, Eyebrow, SectionHeader, Stat } from '@/components/ui';
import { getCompanies, getMarketStats, getMarketTotals } from '@/lib/data';
import { formatCount, formatCountCompact, formatUsd, signedPct } from '@/lib/format';
import { sectorSlug } from '@/lib/markets';
import { siteOrganizationJsonLd, websiteJsonLd } from '@/lib/schema';

const HOME_PREVIEW = 8;
const HOME_SECTORS = 5;

export default async function Home() {
  // Landing shop window: the top-raised companies, not the full directory.
  const [companies, marketStats, marketTotals] = await Promise.all([
    getCompanies({ pageSize: HOME_PREVIEW, sort: 'raised' }),
    getMarketStats(),
    getMarketTotals(),
  ]);

  return (
    <div>
      <JsonLd data={websiteJsonLd()} />
      <JsonLd data={siteOrganizationJsonLd()} />

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

        <div
          className="mt-12 flex flex-wrap gap-x-14 gap-y-3 border-t border-b border-t-ink border-b-line py-7"
          aria-label="What Capbase covers"
        >
          <Stat size="lg" label="Companies" value={formatCountCompact(marketTotals.companyCount)} />
          <Stat size="lg" label="Deals" value={formatCountCompact(marketTotals.dealCount)} />
          <Stat size="lg" label="Investors" value={formatCountCompact(marketTotals.investorCount)} />
          <Stat size="lg" label="Funds" value={formatCountCompact(marketTotals.fundCount)} />
          <Stat size="lg" label="People" value={formatCountCompact(marketTotals.personCount)} />
        </div>
      </section>

      <section className="mx-auto max-w-(--page-max) px-(--page-pad) pt-16">
        <SectionHeader
          title="Top sectors"
          note={
            <Button variant="ghost" size="sm" href="/markets">
              All markets →
            </Button>
          }
        />
        <div className="mt-6 grid grid-cols-5 gap-px overflow-hidden rounded-xl border border-line bg-line max-[900px]:grid-cols-2">
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
          <CompanyTable companies={companies.items} />
        </div>
      </section>

    </div>
  );
}
