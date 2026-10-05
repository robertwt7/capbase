import type { Metadata } from 'next';

import { PageContainer, SectionHeader, Stat } from '@/components/ui';
import { getMarketStats, getMarketTotals } from '@/lib/data';
import { formatCount } from '@/lib/format';
import { canonical } from '@/lib/metadata';
import { MarketTable } from '../MarketTable';

export const metadata: Metadata = {
  title: 'Startup Market Data by Sector',
  description:
    'Deal counts, capital raised, and median valuations across 14 startup sectors, computed live from crowdsourced funding data.',
  ...canonical('/markets'),
};

export default async function MarketsPage() {
  const [marketStats, marketTotals] = await Promise.all([getMarketStats(), getMarketTotals()]);

  return (
    <PageContainer className="pt-14 pb-20">
      <SectionHeader title="Markets" note={marketTotals.quarter} />

      <div
        className="mt-6 flex flex-wrap gap-x-14 gap-y-3 border-t border-b border-t-ink border-b-line py-7"
        aria-label="Market totals"
      >
        <Stat size="lg" label="Companies" value={formatCount(marketTotals.companyCount)} />
        <Stat size="lg" label="Disclosed deals" value={formatCount(marketTotals.dealCount)} />
        <Stat size="lg" label="Investors" value={formatCount(marketTotals.investorCount)} />
      </div>

      <div className="mt-10">
        <MarketTable rows={marketStats} />
      </div>
    </PageContainer>
  );
}
