import { EmptyState, PageContainer } from '@/components/ui';

import { VerifyClaimForm } from './VerifyClaimForm';

export const metadata = {
  title: 'Confirm your company claim',
  robots: { index: false, follow: false },
  // The token is a live credential: never leak it to third parties via Referer.
  referrer: 'no-referrer',
};

export default async function VerifyClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <PageContainer className="pt-14 pb-20">
        <EmptyState className="max-w-[70ch]">
          This page needs the link from your claim email. Start the claim again from the
          company&apos;s profile if it&apos;s gone.
        </EmptyState>
      </PageContainer>
    );
  }
  return <VerifyClaimForm token={token} />;
}
