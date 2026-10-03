'use client';

import { MenuIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui';

const NAV_LINKS = [
  { href: '/companies', label: 'Companies' },
  { href: '/investors', label: 'Investors' },
  { href: '/funds', label: 'Funds' },
  { href: '/people', label: 'People' },
  { href: '/markets', label: 'Markets' },
] as const;

/** A section is current on its directory and on every profile beneath it. */
function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The desktop primary nav. Hidden below `md`, where the drawer takes over. */
export function PrimaryNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-[22px] max-md:hidden" aria-label="Primary">
      {NAV_LINKS.map(({ href, label }) => {
        const current = isCurrent(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'text-sm font-medium transition-colors hover:text-ink',
              current ? 'text-ink' : 'text-graphite-500',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The small-screen drawer: primary nav plus the account actions the header has
 * no room for. A Radix Dialog underneath, so it traps focus, closes on Escape,
 * returns focus to the trigger and sets `aria-expanded` on it.
 */
export function MobileNav({
  userName,
  logoutAction,
}: {
  /** Signed-in user's name, or null when signed out. */
  userName: string | null;
  logoutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="grid size-[38px] shrink-0 place-items-center rounded-sm border border-line bg-surface text-ink transition-colors hover:border-graphite-500 md:hidden"
          aria-label="Open menu"
        >
          <MenuIcon className="size-[18px]" aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[280px] gap-0">
        <SheetHeader className="border-b border-line px-5 py-4">
          <SheetTitle className="text-lg">Menu</SheetTitle>
          <SheetDescription className="sr-only">
            Site navigation and account
          </SheetDescription>
        </SheetHeader>

        <nav aria-label="Primary" className="flex flex-col px-2 py-3">
          {NAV_LINKS.map(({ href, label }) => {
            const current = isCurrent(pathname, href);
            return (
              <SheetClose asChild key={href}>
                <Link
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'rounded-sm px-3 py-2.5 text-[15px] transition-colors hover:bg-paper hover:text-ink',
                    current
                      ? 'font-semibold text-ink'
                      : 'font-medium text-graphite-700',
                  )}
                >
                  {label}
                </Link>
              </SheetClose>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-line p-5">
          {userName ? (
            <>
              <SheetClose asChild>
                <Button
                  variant="primary"
                  shape="pill"
                  size="sm"
                  href="/contribute"
                  block
                >
                  Contribute
                </Button>
              </SheetClose>
              <SheetClose asChild>
                <Button
                  variant="outline"
                  shape="pill"
                  size="sm"
                  href="/profile"
                  block
                >
                  {userName}
                </Button>
              </SheetClose>
              <form action={logoutAction}>
                <Button variant="ghost" size="sm" type="submit" block>
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <>
              <SheetClose asChild>
                <Button
                  variant="primary"
                  shape="pill"
                  size="sm"
                  href="/register"
                  block
                >
                  Join
                </Button>
              </SheetClose>
              <SheetClose asChild>
                <Button
                  variant="outline"
                  shape="pill"
                  size="sm"
                  href="/login"
                  block
                >
                  Sign in
                </Button>
              </SheetClose>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
