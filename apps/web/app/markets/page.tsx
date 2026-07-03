import { PageContainer, SectionHeader, Stat } from '@/components/ui';
import { getCompanies, getMarketStats, getMarketTotals } from '@/lib/data';
import { formatCount, formatUsd } from '@/lib/format';
import { MarketTable } from './MarketTable';

export default async function MarketsPage() {
  const [marketStats, marketTotals, companies] = await Promise.all([
    getMarketStats(),
    getMarketTotals(),
    getCompanies(),
  ]);

  const companiesBySector = new Map<string, number>();
  for (const c of companies) {
    if (c.primarySector) {
      companiesBySector.set(c.primarySector, (companiesBySector.get(c.primarySector) ?? 0) + 1);
    }
  }

  const rows = marketStats.map((stat) => ({
    ...stat,
    companyCount: companiesBySector.get(stat.sector) ?? 0,
  }));

  return (
    <PageContainer as="main" className="pt-14 pb-20">
      <SectionHeader title="Markets" note={marketTotals.quarter} />

      <div
        className="mt-6 flex flex-wrap gap-x-14 gap-y-3 border-t border-b border-t-ink border-b-line py-7"
        aria-label={`${marketTotals.quarter} market totals`}
      >
        <Stat size="lg" label="Capital deployed" value={formatUsd(marketTotals.totalRaisedUsd)} />
        <Stat size="lg" label="Disclosed deals" value={formatCount(marketTotals.dealCount)} />
        <Stat size="lg" label="New unicorns" value={formatCount(marketTotals.newUnicorns)} />
      </div>

      <div className="mt-10">
        <MarketTable rows={rows} />
      </div>
    </PageContainer>
  );
}
