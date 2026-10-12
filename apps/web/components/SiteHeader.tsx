import Link from 'next/link';

import { logout } from '@/app/(account)/actions';
import { getSession } from '@/lib/auth';
import { HeaderSearch } from './HeaderSearch';
import { Logo } from './Logo';
import { MobileNav, PrimaryNav } from './SiteNav';
import { Button } from './ui';

export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-15 max-w-(--page-max) items-center gap-7 px-(--page-pad) max-md:gap-3">
        <Link
          href="/"
          className="inline-flex shrink-0 items-center"
          aria-label="Capbase home"
        >
          <Logo className="h-[22px] text-ink" title="" />
        </Link>

        <PrimaryNav />

        <HeaderSearch />

        <div className="flex shrink-0 items-center gap-4 max-md:hidden">
          {session ? (
            <>
              <Button
                variant="primary"
                shape="pill"
                size="sm"
                href="/contribute"
              >
                Contribute
              </Button>
              <Button variant="ghost" size="sm" href="/profile">
                {session.name}
              </Button>
              <form action={logout}>
                <Button variant="ghost" size="sm" type="submit">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" href="/login">
                Sign in
              </Button>
              <Button variant="primary" shape="pill" size="sm" href="/register">
                Join
              </Button>
            </>
          )}
        </div>

        <MobileNav userName={session?.name ?? null} logoutAction={logout} />
      </div>
    </header>
  );
}
