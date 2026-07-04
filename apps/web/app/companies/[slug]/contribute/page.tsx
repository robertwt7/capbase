import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ComponentType } from 'react';

import { PageContainer, SectionHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { getCompanyDetail } from '@/lib/data';
import { cn } from '@/lib/utils';

import {
  AcquisitionForm,
  DiversityForm,
  ExitForm,
  InvestorForm,
  PersonForm,
  RoundForm,
  type ContributionFormProps,
} from './forms';
import { CONTRIBUTION_TYPES, TYPE_LABELS, type ContributionType } from './types';

const FORMS = {
  round: RoundForm,
  investor: InvestorForm,
  person: PersonForm,
  acquisition: AcquisitionForm,
  exit: ExitForm,
  diversity: DiversityForm,
} satisfies Record<ContributionType, ComponentType<ContributionFormProps>>;

export default async function ContributeToCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { slug } = await params;
  const { type: requested } = await searchParams;
  const type: ContributionType = CONTRIBUTION_TYPES.includes(requested as ContributionType)
    ? (requested as ContributionType)
    : 'round';

  await requireUser(`/companies/${slug}/contribute?type=${type}`);

  const result = await getCompanyDetail(slug);
  if (!result) {
    notFound();
  }
  const { company } = result;

  const ActiveForm = FORMS[type];

  return (
    <PageContainer as="main" className="pt-8 pb-20">
      <Link
        href={`/companies/${company.slug}`}
        className="font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
      >
        ← {company.name}
      </Link>

      <div className="mx-auto mt-8 w-full max-w-2xl">
        <SectionHeader
          title={`Contribute to ${company.name}`}
          note="Reviewed before publishing"
          className="border-b-0 pb-0"
        />
        <p className="mt-2 text-sm text-graphite-500">
          Add what you know — every submission is reviewed by a moderator before it appears on the
          profile.
        </p>

        <nav
          aria-label="Contribution type"
          className="mt-7 flex flex-wrap gap-x-5 gap-y-1 border-b border-line"
        >
          {CONTRIBUTION_TYPES.map((t) => (
            <Link
              key={t}
              href={`/companies/${company.slug}/contribute?type=${t}`}
              className={cn(
                '-mb-px border-b pb-2.5 font-mono text-xs tracking-[0.08em] uppercase transition-colors',
                t === type
                  ? 'border-ink text-ink'
                  : 'border-transparent text-graphite-500 hover:text-ink',
              )}
            >
              {TYPE_LABELS[t]}
            </Link>
          ))}
        </nav>

        <div className="mt-7">
          <ActiveForm slug={company.slug} companyName={company.name} />
        </div>
      </div>
    </PageContainer>
  );
}
