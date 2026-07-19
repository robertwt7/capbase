import type { Metadata } from 'next';

import { PageContainer, SectionHeader } from '@/components/ui';
import { getCompanies } from '@/lib/data';
import { formatCount } from '@/lib/format';
import { companyListQuery } from '@/lib/list-params';
import { CompanyDirectory } from './CompanyDirectory';

export const metadata: Metadata = {
  title: 'Company Directory — Free Startup Funding Data',
  description:
    'Browse private companies with funding rounds, investors, and valuations — free, crowdsourced startup data with no account required.',
  // Filter/page query variants canonicalise to the bare directory URL.
  alternates: { canonical: '/companies' },
};

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
