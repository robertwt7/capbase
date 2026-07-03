import { PageContainer, SectionHeader } from '@/components/ui';
import { getCompanies } from '@/lib/data';
import { CompanyDirectory } from './CompanyDirectory';

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [companies, sp] = await Promise.all([getCompanies(), searchParams]);

  return (
    <PageContainer as="main" className="pt-14 pb-20">
      <SectionHeader title="Companies" note={`${companies.length} profiles`} />
      <CompanyDirectory companies={companies} initial={sp} />
    </PageContainer>
  );
}
