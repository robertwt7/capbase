import type { AuthUser } from '@repo/api';

import { Eyebrow } from '@/components/ui';
import { cn } from '@/lib/utils';

import { ResendVerificationButton } from './ResendVerificationButton';

/**
 * Shown to signed-in, unverified, non-admin users wherever contributing starts.
 * Contributions answer 403 until the email is confirmed; admins are exempt.
 */
export function VerifyEmailBanner({ user, className }: { user: AuthUser; className?: string }) {
  if (user.emailVerified || user.role === 'ADMIN') return null;
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-3 rounded-md border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div>
        <Eyebrow>Unverified email</Eyebrow>
        <p className="mt-1 font-sans text-[14px] text-graphite-700">
          Confirm <span className="font-semibold text-ink">{user.email}</span> to start
          contributing. The link we sent expires after 24 hours.
        </p>
      </div>
      <ResendVerificationButton />
    </div>
  );
}
