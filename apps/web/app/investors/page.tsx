import { PageContainer, SectionHeader } from '@/components/ui';
import { getInvestors } from '@/lib/data';
import { InvestorDirectory } from './InvestorDirectory';

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [investors, sp] = await Promise.all([getInvestors(), searchParams]);

  return (
    <PageContainer as="main" className="pt-14 pb-20">
      <SectionHeader title="Investors" note={`${investors.length} firms`} />
      <InvestorDirectory investors={investors} initial={sp} />
    </PageContainer>
  );
}
