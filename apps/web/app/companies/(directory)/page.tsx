import type { Metadata } from 'next';

import { PageContainer, SectionHeader } from '@/components/ui';
import { getCompanies } from '@/lib/data';
import { formatCount } from '@/lib/format';
import { companyListQuery, directoryCanonical } from '@/lib/list-params';
import { canonical } from '@/lib/metadata';
import { CompanyDirectory } from './CompanyDirectory';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<Metadata> {
  return {
    title: 'Company Directory — Free Startup Funding Data',
    description:
      'Browse private companies with funding rounds, investors, and valuations — free, crowdsourced startup data with no account required.',
    ...canonical(directoryCanonical('/companies', await searchParams)),
  };
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const result = await getCompanies(companyListQuery(sp));

  return (
    <PageContainer className="pt-14 pb-20">
      <SectionHeader title="Companies" note={`${formatCount(result.total)} profiles`} />
      <CompanyDirectory result={result} initial={sp} />
    </PageContainer>
  );
}
