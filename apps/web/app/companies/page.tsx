import { PageContainer, SectionHeader } from '@/components/ui';
import { getCompanies } from '@/lib/data';
import { formatCount } from '@/lib/format';
import { companyListQuery } from '@/lib/list-params';
import { CompanyDirectory } from './CompanyDirectory';

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const result = await getCompanies(companyListQuery(sp));

  return (
    <PageContainer as="main" className="pt-14 pb-20">
      <SectionHeader title="Companies" note={`${formatCount(result.total)} profiles`} />
      <CompanyDirectory result={result} initial={sp} />
    </PageContainer>
  );
}
