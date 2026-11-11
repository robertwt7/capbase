import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getUpdates } from '@/lib/monitoring';
import { Button, EmptyState, SectionHeader } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
export const metadata = {
  title: 'Your updates',
  robots: { index: false, follow: false },
};
export default async function UpdatesPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  await requireUser('/profile/updates');
  const { cursor } = await searchParams;
  // 403 = no current full access; anything else is a failure worth retrying.
  const result = await getUpdates(cursor).then(
    (page) => ({ page, denied: false }),
    (err: unknown) => ({ page: null, denied: err instanceof ApiError && err.status === 403 }),
  );
  const { page } = result;
  return (
    <div className="mx-auto w-full max-w-[720px] px-(--page-pad) pt-8 pb-20">
      <Link href="/profile">← Profile</Link>
      <div className="mt-8">
        <SectionHeader as="h1" title="Your updates" />
      </div>
      {!page ? (
        <p className="mt-6">
          {result.denied
            ? 'Updates need full access: any approved contribution unlocks them.'
            : 'Updates could not be loaded. Try again in a moment.'}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-graphite-500">
            Monitoring checks hourly. Updates begin after preparation; brief
            changes between checks may not appear.
          </p>
          {page.items.length ? (
            <ul className="mt-6">
              {page.items.map((item) => (
                <li key={item.id} className="border-b border-line py-5">
                  <Link
                    href={`/companies/${item.company.slug}`}
                    prefetch={false}
                    className="font-display text-lg font-semibold underline underline-offset-4"
                  >
                    {item.company.name}
                  </Link>
                  {item.round ? (
                    <p className="mt-2 text-sm">
                      Newly recorded funding · {item.round.name} ·{' '}
                      {formatDate(item.round.date)} ·{' '}
                      <span className="font-mono">
                        {/* 0 with no local amount is the undisclosed sentinel, never "$0". */}
                        {item.round.amountUsd === 0 && item.round.amountLocal == null
                          ? 'Undisclosed'
                          : formatMoney(item.round.amountLocal ?? item.round.amountUsd, item.round.currency)}
                      </span>
                    </p>
                  ) : (
                    <p className="mt-2 text-sm">
                      New match for{' '}
                      {item.search ? (
                        <Link href={item.search.path} className="underline">
                          {item.search.name}
                        </Link>
                      ) : null}
                    </p>
                  )}
                  <p className="mt-2 font-mono text-xs text-graphite-500">
                    Observed {formatDate(item.observedAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState className="mt-6">Nothing new yet</EmptyState>
          )}
          {page.nextCursor ? (
            <Button
              className="mt-6"
              variant="outline"
              href={`/profile/updates?cursor=${encodeURIComponent(page.nextCursor)}`}
            >
              Older updates
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
