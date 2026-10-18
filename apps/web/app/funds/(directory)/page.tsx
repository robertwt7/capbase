import type { Metadata } from 'next';

import { PageContainer, SectionHeader } from '@/components/ui';
import { getToken } from '@/lib/auth';
import { getFunds } from '@/lib/data';
import { formatCount } from '@/lib/format';
import { directoryCanonical, fundListQuery } from '@/lib/list-params';
import { canonical } from '@/lib/metadata';
import { FundDirectory } from './FundDirectory';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<Metadata> {
  return {
    title: 'Fund Directory — Vintages, Sizes & Managers',
    description:
      'Private funds from SEC filings and partners: manager, strategy, status, vintage year and size.',
    ...canonical(directoryCanonical('/funds', await searchParams)),
  };
}

export default async function FundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const query = fundListQuery(sp);
  const [result, token] = await Promise.all([getFunds(query), getToken()]);

  return (
    <PageContainer className="pt-14 pb-20">
      <SectionHeader title="Funds" note={`${formatCount(result.total)} funds`} />
      <FundDirectory result={result} initial={sp} signedIn={Boolean(token)} />
    </PageContainer>
  );
}
