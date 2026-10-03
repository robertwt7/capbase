import type { Metadata } from 'next';

import { PageContainer, SectionHeader } from '@/components/ui';
import { getPeople } from '@/lib/data';
import { formatCount } from '@/lib/format';
import { personListQuery } from '@/lib/list-params';
import { PeopleDirectory } from './PeopleDirectory';

export const metadata: Metadata = {
  title: 'People Directory — Founders, Executives & Directors',
  description:
    'Founders, executives and directors named in public filings, deduplicated across every company and firm they appear at.',
  alternates: { canonical: '/people' },
};

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const result = await getPeople(personListQuery(sp));

  return (
    <PageContainer className="pt-14 pb-20">
      <SectionHeader title="People" note={`${formatCount(result.total)} people`} />
      <PeopleDirectory result={result} initial={sp} />
    </PageContainer>
  );
}
