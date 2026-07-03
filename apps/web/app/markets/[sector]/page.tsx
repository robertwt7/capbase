import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SECTORS } from '@repo/api';

import { CompanyTable } from '@/components/CompanyTable';
import { EmptyState, Eyebrow, PageContainer, SectionHeader, Stat } from '@/components/ui';
import { getCompanies, getMarketStats } from '@/lib/data';
import { formatCount, formatUsd } from '@/lib/format';
import { sectorFromSlug, sectorSlug } from '@/lib/markets';

export function generateStaticParams() {
  return SECTORS.map((s) => ({ sector: sectorSlug(s) }));
}

export default async function SectorPage({ params }: { params: Promise<{ sector: string }> }) {
  const sector = sectorFromSlug((await params).sector);
  if (!sector) notFound();

  const [stats, companies] = await Promise.all([getMarketStats(), getCompanies()]);
  const stat = stats.find((s) => s.sector === sector);
  const inSector = companies.filter((c) => c.primarySector === sector);

  return (
    <PageContainer as="main" className="pt-14 pb-20">
      <Eyebrow>
        <Link href="/markets" className="transition-colors hover:text-ink">
          Markets
        </Link>{' '}
        / {sector}
      </Eyebrow>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink">{sector}</h1>

      {stat ? (
        <div
          className="mt-8 flex flex-wrap gap-x-14 gap-y-3 border-t border-b border-t-ink border-b-line py-7"
          aria-label={`${sector} market stats`}
        >
          <Stat size="lg" label="Disclosed deals" value={formatCount(stat.dealCount)} />
          <Stat size="lg" label="Capital raised" value={formatUsd(stat.totalRaisedUsd)} />
          <Stat size="lg" label="Median valuation" value={formatUsd(stat.medianValuationUsd)} />
        </div>
      ) : null}

      <div className="mt-10">
        <SectionHeader title="Companies" note={`${inSector.length} in ${sector}`} />
        {inSector.length ? (
          <div className="mt-6">
            <CompanyTable companies={inSector} />
          </div>
        ) : (
          <EmptyState className="mt-6">
            No companies in this sector yet — contribute one to get it on the map.
          </EmptyState>
        )}
      </div>
    </PageContainer>
  );
}
