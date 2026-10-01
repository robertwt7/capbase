import { Button, EmptyState, PageContainer } from '@/components/ui';

import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false },
  // The token is a live credential: never leak it to third parties via Referer.
  referrer: 'no-referrer',
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <PageContainer as="main" className="pt-14 pb-20">
        <EmptyState
          className="max-w-[70ch]"
          action={
            <Button variant="primary" size="sm" href="/forgot-password">
              Request a reset link
            </Button>
          }
        >
          This page needs the link from your reset email. Request a new one if it&apos;s gone.
        </EmptyState>
      </PageContainer>
    );
  }
  return <ResetPasswordForm token={token} />;
}
