import Link from 'next/link';
import { MAX_ACTIVE_API_KEYS, type ApiKeySummary } from '@repo/api';

import { Badge, Button, EmptyState, SectionHeader } from '@/components/ui';
import { VerifyEmailBanner } from '@/components/VerifyEmailBanner';
import { listApiKeys } from '@/lib/api-keys';
import { requireUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { SITE_URL } from '@/lib/site';

import { revokeApiKeyAction } from './actions';
import { ApiKeyForm } from './ApiKeyForm';

export const metadata = {
  title: 'API keys',
  robots: { index: false, follow: false },
};

export default async function ApiKeysPage() {
  const user = await requireUser('/profile/api-keys');
  const allowed = user.role === 'CONTRIBUTOR' || user.role === 'ADMIN';
  const blocked = allowed && user.role !== 'ADMIN' && !user.emailVerified;
  const keys = allowed && !blocked ? await listApiKeys() : [];

  return (
    <div className="mx-auto w-full max-w-[720px] px-(--page-pad) pt-8 pb-20">
      <Link
        href="/profile"
        className="font-mono text-[13px] text-graphite-500 transition-colors hover:text-ink"
      >
        ← Profile
      </Link>

      <div className="mt-8">
        <SectionHeader
          as="h1"
          title="API keys"
          note={allowed ? `${keys.length} of ${MAX_ACTIVE_API_KEYS}` : undefined}
        />
        <p className="mt-4 max-w-[62ch] text-[15px] leading-[1.6] text-graphite-700">
          Keys let a script read Capbase and add data through the public API, under your name. The{' '}
          <Link href="/developers" className="text-ink underline underline-offset-[3px]">
            developer guide
          </Link>{' '}
          covers authentication, limits and what each endpoint accepts.
        </p>

        {!allowed ? (
          <EmptyState
            className="mt-7"
            action={
              <Button variant="outline" size="sm" href="/developers">
                Read the developer guide
              </Button>
            }
          >
            API access is granted by Capbase admins. If you plan to contribute data in bulk, write
            to us and say what you&apos;d like to add.
          </EmptyState>
        ) : blocked ? (
          <VerifyEmailBanner user={user} className="mt-7" />
        ) : (
          <div className="mt-7 flex flex-col gap-7">
            <KeyList keys={keys} />
            {keys.length < MAX_ACTIVE_API_KEYS ? (
              <ApiKeyForm canMintAdmin={user.role === 'ADMIN'} siteUrl={SITE_URL} />
            ) : (
              <EmptyState>
                You have {MAX_ACTIVE_API_KEYS} active keys, the most an account can hold. Revoke one
                to create another.
              </EmptyState>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function KeyList({ keys }: { keys: ApiKeySummary[] }) {
  if (keys.length === 0) {
    return <EmptyState>No keys yet. Create one below; its secret is shown once.</EmptyState>;
  }
  return (
    <ul
      className="divide-y divide-line rounded-md border border-line bg-surface"
      aria-label="Your API keys"
    >
      {keys.map((key) => (
        <li
          key={key.id}
          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink [overflow-wrap:anywhere]">{key.name}</span>
              <Badge variant="box" mono>
                {key.scope}
              </Badge>
            </div>
            <p className="mt-1 font-mono text-[13px] text-graphite-700">{key.prefix}_…</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[12px] text-graphite-500">
              <dt className="uppercase tracking-[0.06em]">Allowlist</dt>
              <dd className="[overflow-wrap:anywhere]">
                {key.allowedCidrs.length ? key.allowedCidrs.join(', ') : 'Any address'}
              </dd>
              <dt className="uppercase tracking-[0.06em]">Created</dt>
              <dd>{formatDate(key.createdAt)}</dd>
              <dt className="uppercase tracking-[0.06em]">Last used</dt>
              <dd>{key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}</dd>
            </dl>
          </div>
          <form action={revokeApiKeyAction.bind(null, key.id)} className="shrink-0">
            <Button
              variant="outline"
              shape="box"
              size="sm"
              type="submit"
              className="font-semibold"
              aria-label={`Revoke ${key.name}`}
            >
              Revoke
            </Button>
          </form>
        </li>
      ))}
    </ul>
  );
}
