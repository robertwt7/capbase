import Link from 'next/link';
import { notFound } from 'next/navigation';
import { REPORTABLE_TYPES, type ReportableType } from '@repo/api';

import { PageContainer, SectionHeader } from '@/components/ui';
import { getCompanyDetail, getInvestor, getPerson } from '@/lib/data';
import { turnstileSiteKey } from '@/lib/turnstile';

import { ReportForm } from './ReportForm';

export const metadata = {
  title: 'Report an issue',
  robots: { index: false, follow: false },
};

/** Where each reportable type's public profile lives. */
const PROFILE_PATH: Record<ReportableType, string> = {
  company: 'companies',
  investor: 'investors',
  person: 'people',
};

/** The profile's display name, or null when the public can't see it. */
async function profileName(
  type: ReportableType,
  slug: string,
): Promise<string | null> {
  switch (type) {
    case 'company':
      return (await getCompanyDetail(slug))?.company.name ?? null;
    case 'investor':
      return (await getInvestor(slug))?.name ?? null;
    case 'person':
      return (await getPerson(slug))?.name ?? null;
  }
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ type: string; slug: string }>;
}) {
  const { type: rawType, slug } = await params;
  if (!REPORTABLE_TYPES.includes(rawType as ReportableType)) notFound();
  const type = rawType as ReportableType;

  const name = await profileName(type, slug);
  if (!name) notFound();

  const profileHref = `/${PROFILE_PATH[type]}/${slug}`;

  return (
    <PageContainer className="pt-8 pb-20">
      <Link
        href={profileHref}
        className="font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
      >
        ← {name}
      </Link>

      <div className="mx-auto mt-8 w-full max-w-2xl">
        <SectionHeader
          title={`Report an issue with ${name}`}
          note="No account needed"
          className="border-b-0 pb-0"
        />
        <p className="mt-2 text-sm text-graphite-500">
          Something wrong, out of date, or about you and you want it removed?
          Tell us here and an admin will review it. Our{' '}
          <Link
            href="/takedown"
            className="text-ink underline underline-offset-[3px]"
          >
            takedown &amp; removal policy
          </Link>{' '}
          covers what we remove, what we correct, and how long it takes.
        </p>

        <div className="mt-7">
          <ReportForm
            type={type}
            slug={slug}
            profileHref={profileHref}
            name={name}
            turnstileSiteKey={turnstileSiteKey()}
          />
        </div>
      </div>
    </PageContainer>
  );
}
