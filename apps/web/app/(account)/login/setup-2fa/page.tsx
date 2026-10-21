import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { MFA_COOKIE } from '@/lib/auth';

import { SetupTwoFactor } from './SetupTwoFactor';

export const metadata = {
  title: 'Set up two-factor authentication',
  robots: { index: false, follow: false },
};

/** Only a relative path on this site; anything else lands on the home page. */
const safeNext = (next?: string) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

/**
 * Forced setup: a role that requires 2FA signed in with a password and has no factor. The
 * password step left an MFA_SETUP challenge in the httpOnly cookie; without it there is
 * nothing to finish, so start over.
 */
export default async function SetupTwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if (!(await cookies()).get(MFA_COOKIE)) {
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  }
  return <SetupTwoFactor next={safeNext(next)} />;
}
