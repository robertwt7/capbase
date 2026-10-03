import type { AdminUser } from '@repo/api';

import { Badge, Button, Input, Pagination } from '../../../components/ui';
import { getUsers } from '../../../lib/admin';
import { requireAdmin } from '../../../lib/auth';
import { formatCount, formatDate } from '../../../lib/format';
import { setBannedAction, setRoleAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const me = await requireAdmin();

  const { q: rawQ, page: rawPage } = await searchParams;
  const q = rawQ?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1);
  const users = await getUsers(q, page);

  const href = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (p > 1) params.set('page', String(p));
    const query = params.toString();
    return `/admin/users${query ? `?${query}` : ''}`;
  };

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-9">
      <header className="border-b border-ink pb-6">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Users
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] text-graphite-700">
          Banning signs the account out everywhere, blocks sign-in, and rejects
          everything it still has pending. Lifting a ban restores access but not
          the rejected submissions.
        </p>
      </header>

      <form
        action="/admin/users"
        className="flex max-w-md gap-2 pt-6"
        role="search"
      >
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search by email or name"
          aria-label="Search users"
          autoComplete="off"
        />
        <Button variant="outline" shape="box" size="sm" type="submit">
          Search
        </Button>
      </form>

      <p className="pt-4 font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
        {formatCount(users.total)} {users.total === 1 ? 'account' : 'accounts'}
        {q ? ` matching “${q}”` : ''}
      </p>

      {users.items.length === 0 ? (
        <p className="mt-6 rounded-md border border-line bg-surface px-5 py-8 text-center text-[15px] text-graphite-500">
          No accounts found.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full min-w-[720px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-line font-mono text-[11px] tracking-[0.06em] text-graphite-500 uppercase">
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 text-right font-medium">Pending</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.items.map((user) => (
                <UserRow key={user.id} user={user} isSelf={user.id === me.id} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={users.page}
        pageSize={users.pageSize}
        total={users.total}
        href={href}
        className="mt-6"
      />
    </div>
  );
}

function UserRow({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const banned = user.bannedAt !== null;
  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="px-4 py-3">
        <div className="font-semibold text-ink">{user.name}</div>
        <div className="font-mono text-[12px] text-graphite-500">
          {user.email}
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-[13px] text-graphite-700">
        {formatDate(user.createdAt)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-[13px] text-graphite-700">
        {formatCount(user.pendingCount)}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {user.role === 'ADMIN' ? (
            <Badge variant="box" mono>
              Admin
            </Badge>
          ) : null}
          {banned ? (
            <Badge
              variant="pill"
              mono
              className="border-ink font-semibold text-ink"
            >
              Banned {formatDate(user.bannedAt as string)}
            </Badge>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3">
        {isSelf ? (
          <span className="block text-right text-[13px] text-graphite-500">
            You
          </span>
        ) : (
          <div className="flex items-center justify-end gap-3">
            <form
              action={setRoleAction.bind(
                null,
                user.id,
                user.role === 'ADMIN' ? 'USER' : 'ADMIN',
              )}
            >
              <Button variant="ghost" shape="box" size="sm" type="submit">
                {user.role === 'ADMIN' ? 'Revoke admin' : 'Make admin'}
              </Button>
            </form>
            <form action={setBannedAction.bind(null, user.id, !banned)}>
              <Button variant="outline" shape="box" size="sm" type="submit">
                {banned ? 'Lift ban' : 'Ban'}
              </Button>
            </form>
          </div>
        )}
      </td>
    </tr>
  );
}
