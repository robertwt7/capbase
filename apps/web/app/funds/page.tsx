import type { Metadata } from 'next';

import { PageContainer, SectionHeader } from '@/components/ui';
import { getFunds } from '@/lib/data';
import { formatCount } from '@/lib/format';
import { fundListQuery } from '@/lib/list-params';
import { FundDirectory } from './FundDirectory';

export const metadata: Metadata = {
  title: 'Fund Directory — Vintages, Sizes & Managers',
  description:
    'Private funds from SEC filings: manager, strategy, vintage year and size — free, open fund data.',
  alternates: { canonical: '/funds' },
};

export default async function FundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const query = fundListQuery(sp);
  const result = await getFunds(query);

  return (
    <PageContainer as="main" className="pt-14 pb-20">
      <SectionHeader title="Funds" note={`${formatCount(result.total)} funds`} />
      <FundDirectory result={result} initial={sp} />
    </PageContainer>
  );
}
