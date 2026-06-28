import Link from 'next/link';
import type { MyContribution } from '@repo/api';

import { Badge, Button, Card } from '../../../components/ui';
import { getMyContributions, requireUser } from '../../../lib/auth';
import { formatDate } from '../../../lib/format';
import { logout } from '../actions';

import styles from '../account.module.css';

export default async function ProfilePage() {
  const user = await requireUser('/profile');
  const { access, items } = await getMyContributions();

  return (
    <main className={styles.profileMain}>
      <div className={styles.identity}>
        <div>
          <h1 className={styles.name}>
            {user.name}
            {user.role === 'ADMIN' ? (
              <Badge variant="pill" mono className={styles.roleTag}>
                Admin
              </Badge>
            ) : null}
          </h1>
          <p className={styles.email}>{user.email}</p>
        </div>
        <div className={styles.identityActions}>
          <Button variant="primary" shape="pill" size="sm" href="/contribute">
            Contribute
          </Button>
          <form action={logout}>
            <Button variant="ghost" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </div>

      <AccessPanel access={access} role={user.role} />

      <h2 className={styles.sectionTitle}>Your contributions</h2>
      {items.length === 0 ? (
        <p className={styles.emptyText}>
          You haven&apos;t contributed yet. Add a company or funding round to unlock full profiles.
        </p>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <ContributionRow key={`${item.type}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}

function AccessPanel({
  access,
  role,
}: {
  access: { unlocked: boolean; unlockedUntil: string | null };
  role: 'USER' | 'ADMIN';
}) {
  if (role === 'ADMIN') {
    return (
      <Card emphasis className={styles.access}>
        <p className={styles.accessTitle}>Full access</p>
        <p className={styles.accessNote}>Admins always see complete company profiles.</p>
      </Card>
    );
  }

  if (access.unlocked && access.unlockedUntil) {
    return (
      <Card emphasis className={styles.access}>
        <p className={styles.accessTitle}>Full access — unlocked</p>
        <p className={styles.accessNote}>
          Active until {formatDate(access.unlockedUntil)}. Keep contributing to stay unlocked.
        </p>
      </Card>
    );
  }

  return (
    <Card className={styles.access}>
      <p className={styles.accessTitle}>Locked</p>
      <p className={styles.accessNote}>
        {access.unlockedUntil
          ? `Your access lapsed after ${formatDate(access.unlockedUntil)}. `
          : ''}
        Contribute to unlock full company profiles for the next 30 days.
      </p>
    </Card>
  );
}

function ContributionRow({ item }: { item: MyContribution }) {
  return (
    <div className={styles.item}>
      <Badge variant="box" mono className={styles.itemType}>
        {item.type}
      </Badge>
      <span className={styles.itemLabel}>
        {item.label}
        {item.companyName && item.companySlug ? (
          <Link href={`/companies/${item.companySlug}`} className={styles.itemCompany}>
            {' · '}
            {item.companyName}
          </Link>
        ) : null}
      </span>
      <span className={styles.itemStatus}>{item.moderationStatus}</span>
      <span className={styles.itemDate}>{formatDate(item.createdAt)}</span>
    </div>
  );
}
