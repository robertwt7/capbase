import { ROLES, type AdminUser, type Role } from '@repo/api';

import { Badge, Button, Input, PageContainer, Pagination } from '../../../components/ui';
import { getUsers } from '../../../lib/admin';
import { requireAdmin } from '../../../lib/auth';
import { formatCount, formatDate } from '../../../lib/format';
import { resetMfaAction, setBannedAction, setRoleAction } from './actions';

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
    <PageContainer className="py-9">
      <header className="border-b border-ink pb-6">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Users
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] text-graphite-700">
          Banning signs the account out everywhere, blocks sign-in, and rejects
          everything it still has pending. Lifting a ban restores access but not
          the rejected submissions. Contributors can mint API keys for the public
          API; demoting or banning someone revokes the keys their new role no
          longer allows. Resetting 2FA removes an account’s authenticator app,
          passkeys and recovery codes and signs it out everywhere — for someone
          who lost their device. Contributors and admins must set it up again
          before they can sign in.
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
    </PageContainer>
  );
}

const ROLE_LABEL: Record<Role, string> = {
  USER: 'User',
  CONTRIBUTOR: 'Contributor',
  ADMIN: 'Admin',
};

/** Why a role change matters, as a tooltip on its button. */
function roleChangeTitle(from: Role, to: Role): string | undefined {
  const rank = ROLES.indexOf(to) - ROLES.indexOf(from);
  if (rank >= 0) return undefined;
  return to === 'USER'
    ? 'Revokes every API key this account holds'
    : 'Revokes this account’s admin API keys';
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
          {user.role !== 'USER' ? (
            <Badge variant="box" mono>
              {ROLE_LABEL[user.role]}
            </Badge>
          ) : null}
          {user.mfaEnabled ? (
            <Badge variant="box" mono>
              2FA
            </Badge>
          ) : user.role !== 'USER' ? (
            <Badge variant="box" mono className="border-dashed text-graphite-500">
              No 2FA
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
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {ROLES.filter((role) => role !== user.role).map((role) => (
              <form key={role} action={setRoleAction.bind(null, user.id, role)}>
                <Button
                  variant="ghost"
                  shape="box"
                  size="sm"
                  type="submit"
                  title={roleChangeTitle(user.role, role)}
                >
                  Make {ROLE_LABEL[role].toLowerCase()}
                </Button>
              </form>
            ))}
            {user.mfaEnabled ? (
              <form action={resetMfaAction.bind(null, user.id)}>
                <Button
                  variant="outline"
                  shape="box"
                  size="sm"
                  type="submit"
                  title="Removes every second factor and signs the account out everywhere"
                >
                  Reset 2FA
                </Button>
              </form>
            ) : null}
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
