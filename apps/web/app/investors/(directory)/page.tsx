import type { Metadata } from 'next';

import { PageContainer, SectionHeader } from '@/components/ui';
import { getInvestors } from '@/lib/data';
import { formatCount } from '@/lib/format';
import { directoryCanonical, investorListQuery } from '@/lib/list-params';
import { canonical } from '@/lib/metadata';
import { InvestorDirectory } from './InvestorDirectory';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<Metadata> {
  return {
    title: 'Investor Directory — VCs, Angels & Funds',
    description:
      'Venture firms, growth funds, and angels with their portfolio companies and sectors — free, crowdsourced investor data.',
    ...canonical(directoryCanonical('/investors', await searchParams)),
  };
}

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const result = await getInvestors(investorListQuery(sp));

  return (
    <PageContainer className="pt-14 pb-20">
      <SectionHeader title="Investors" note={`${formatCount(result.total)} firms`} />
      <InvestorDirectory result={result} initial={sp} />
    </PageContainer>
  );
}
