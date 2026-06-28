import Link from 'next/link';

import { logout } from '@/app/(account)/actions';
import { getSession } from '@/lib/auth';
import { Button } from './ui';

export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-15 max-w-(--page-max) items-center gap-7 px-(--page-pad)">
        <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Capbase home">
          {/* Stepped corner echoes the funding-ladder signature. */}
          <span
            className="size-4 bg-ink"
            aria-hidden="true"
            style={{ clipPath: 'polygon(0 0, 100% 0, 100% 60%, 60% 60%, 60% 100%, 0 100%)' }}
          />
          <span className="font-display text-lg font-bold tracking-tight text-ink">Capbase</span>
        </Link>

        <nav className="flex gap-[22px] max-md:hidden" aria-label="Primary">
          <Link href="/" className="text-sm font-medium text-graphite-500 transition-colors hover:text-ink">
            Companies
          </Link>
          <Link href="/" className="text-sm font-medium text-graphite-500 transition-colors hover:text-ink">
            Investors
          </Link>
          <Link href="/" className="text-sm font-medium text-graphite-500 transition-colors hover:text-ink">
            Markets
          </Link>
        </nav>

        <form
          className="ml-auto flex h-[38px] w-80 max-w-[38vw] items-center gap-2 rounded-[9px] border border-line bg-surface px-3 transition-colors focus-within:border-graphite-500 max-md:w-auto max-md:max-w-none max-md:flex-1"
          role="search"
          action="/"
        >
          <span className="grid size-[18px] shrink-0 place-items-center rounded border border-line font-mono text-xs text-graphite-500" aria-hidden="true">
            /
          </span>
          <input
            className="min-w-0 flex-1 border-none bg-transparent font-sans text-sm text-ink outline-none placeholder:text-graphite-400"
            type="search"
            name="q"
            placeholder="Search companies, investors, sectors"
            aria-label="Search Capbase"
          />
        </form>

        <div className="flex shrink-0 items-center gap-4">
          {session ? (
            <>
              <Button variant="primary" shape="pill" size="sm" href="/contribute">
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
      </div>
    </header>
  );
}
