import Link from 'next/link';

import { SectionHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';

import { SettingsForms } from './SettingsForms';

export const metadata = {
  title: 'Account settings',
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const user = await requireUser('/profile/settings');

  return (
    <main className="mx-auto w-full max-w-[560px] px-(--page-pad) pt-8 pb-20">
      <Link
        href="/profile"
        className="font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
      >
        ← Profile
      </Link>

      <div className="mt-8">
        <SectionHeader as="h1" title="Account settings" note={user.email} />
        <div className="mt-7">
          <SettingsForms user={user} />
        </div>
      </div>
    </main>
  );
}
