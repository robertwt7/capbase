import { Button, EmptyState, PageContainer } from '@/components/ui';

import { VerifyEmailForm } from './VerifyEmailForm';

export const metadata = {
  title: 'Confirm your email',
  robots: { index: false, follow: false },
  // The token is a live credential: never leak it to third parties via Referer.
  referrer: 'no-referrer',
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <PageContainer className="pt-14 pb-20">
        <EmptyState
          className="max-w-[70ch]"
          action={
            <Button variant="primary" size="sm" href="/profile">
              Resend from your profile
            </Button>
          }
        >
          This page needs the link from your confirmation email. Sign in and send yourself a new
          one if it&apos;s gone.
        </EmptyState>
      </PageContainer>
    );
  }
  return <VerifyEmailForm token={token} />;
}
