import Link from 'next/link';

import { SectionHeader } from '@/components/ui';
import { VerifyEmailBanner } from '@/components/VerifyEmailBanner';
import { getMfaStatus } from '@/lib/account';
import { requireUser } from '@/lib/auth';

import { DigestPreference } from './DigestPreference';
import { canSaveSearches } from '@/lib/saved-searches';
import { SecuritySection } from './SecuritySection';
import { SettingsForms } from './SettingsForms';

export const metadata = {
  title: 'Account settings',
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const user = await requireUser('/profile/settings');
  // The Security section is left out (not the page) if the API can't answer.
  const [mfa, fullAccess] = await Promise.all([
    getMfaStatus().catch(() => null),
    canSaveSearches(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[560px] px-(--page-pad) pt-8 pb-20">
      <Link
        href="/profile"
        className="font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
      >
        ← Profile
      </Link>

      <div className="mt-8">
        <SectionHeader as="h1" title="Account settings" note={user.email} />
        <VerifyEmailBanner user={user} className="mt-7" />
        <div className="mt-7">
          <SettingsForms user={user} />
        </div>
        <DigestPreference
          enabled={Boolean(user.digestOptInAt)}
          canEnable={fullAccess && user.emailVerified}
        />
        {mfa ? (
          <div className="mt-12">
            <SecuritySection status={mfa} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
