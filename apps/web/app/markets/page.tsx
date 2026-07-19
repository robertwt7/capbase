import { PageContainer, SectionHeader, Stat } from '@/components/ui';
import { getMarketStats, getMarketTotals } from '@/lib/data';
import { formatCount, formatUsd } from '@/lib/format';
import { MarketTable } from './MarketTable';

export default async function MarketsPage() {
  const [marketStats, marketTotals] = await Promise.all([getMarketStats(), getMarketTotals()]);

  return (
    <PageContainer as="main" className="pt-14 pb-20">
      <SectionHeader title="Markets" note={marketTotals.quarter} />

      <div
        className="mt-6 flex flex-wrap gap-x-14 gap-y-3 border-t border-b border-t-ink border-b-line py-7"
        aria-label={`${marketTotals.quarter} market totals`}
      >
        <Stat size="lg" label="Capital deployed" value={formatUsd(marketTotals.totalRaisedUsd)} />
        <Stat size="lg" label="Disclosed deals" value={formatCount(marketTotals.dealCount)} />
        <Stat size="lg" label="Unicorns" value={formatCount(marketTotals.newUnicorns)} />
      </div>

      <div className="mt-10">
        <MarketTable rows={marketStats} />
      </div>
    </PageContainer>
  );
}
