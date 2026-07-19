import { PageContainer, SectionHeader } from '@/components/ui';
import { getInvestors } from '@/lib/data';
import { formatCount } from '@/lib/format';
import { investorListQuery } from '@/lib/list-params';
import { InvestorDirectory } from './InvestorDirectory';

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
