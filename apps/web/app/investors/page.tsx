import type { Metadata } from 'next';

import { PageContainer, SectionHeader } from '@/components/ui';
import { getInvestors } from '@/lib/data';
import { formatCount } from '@/lib/format';
import { investorListQuery } from '@/lib/list-params';
import { InvestorDirectory } from './InvestorDirectory';

export const metadata: Metadata = {
  title: 'Investor Directory — VCs, Angels & Funds',
  description:
    'Venture firms, growth funds, and angels with their portfolio companies and sectors — free, crowdsourced investor data.',
  alternates: { canonical: '/investors' },
};

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const result = await getInvestors(investorListQuery(sp));

  return (
    <PageContainer as="main" className="pt-14 pb-20">
      <SectionHeader title="Investors" note={`${formatCount(result.total)} firms`} />
      <InvestorDirectory result={result} initial={sp} />
    </PageContainer>
  );
}
