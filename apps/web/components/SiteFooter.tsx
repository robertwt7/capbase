import Link from 'next/link';

import { PageContainer } from '@/components/ui';
import { SOURCE_URL, SUPPORT_EMAIL } from '@/lib/site';
import { CookiePreferencesButton } from './ConsentBanner';
import { LogoMark } from './Logo';

// The keyword-anchored labels ("Crunchbase alternative") are deliberate
// internal anchor text for the comparison landing pages.
const COLUMNS: { label: string; links: { label: string; href: string }[] }[] = [
  {
    label: 'Explore',
    links: [
      { label: 'Companies', href: '/companies' },
      { label: 'Investors', href: '/investors' },
      { label: 'Funds', href: '/funds' },
      { label: 'Markets', href: '/markets' },
      { label: 'Compare', href: '/compare' },
    ],
  },
  {
    label: 'Capbase',
    links: [
      { label: 'About', href: '/about' },
      { label: 'FAQ', href: '/faq' },
      { label: 'Data & sources', href: '/data' },
      { label: 'Contribute', href: '/contribute' },
    ],
  },
  {
    label: 'Compare',
    links: [
      { label: 'Crunchbase alternative', href: '/alternatives/crunchbase' },
      { label: 'PitchBook alternative', href: '/alternatives/pitchbook' },
    ],
  },
  {
    label: 'Legal',
    links: [
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Takedown policy', href: '/takedown' },
    ],
  },
];

export function SiteFooter({ showCookiePreferences }: { showCookiePreferences: boolean }) {
  return (
    <footer className="mt-24 border-t border-line">
      <PageContainer className="py-12">
        <div className="grid grid-cols-4 gap-x-8 gap-y-10 max-[720px]:grid-cols-2">
          {COLUMNS.map((column) => (
            <nav key={column.label} aria-label={column.label}>
              <h2 className="font-mono text-[11px] font-medium tracking-[0.14em] text-graphite-500 uppercase">
                {column.label}
              </h2>
              <ul className="mt-4 flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-graphite-700 transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-t border-line pt-6 font-mono text-xs text-graphite-500">
          <span className="inline-flex items-center gap-2.5">
            <LogoMark className="h-3 text-ink" />
            © {new Date().getFullYear()} Capbase
          </span>
          <span>
            <Link href="/data" className="transition-colors hover:text-ink">
              Data
            </Link>{' '}
            CC BY-NC 4.0 ·{' '}
            <a href={SOURCE_URL} className="transition-colors hover:text-ink">
              Code
            </a>{' '}
            AGPL-3.0
          </span>
          {showCookiePreferences ? (
            <CookiePreferencesButton className="cursor-pointer transition-colors hover:text-ink" />
          ) : null}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="transition-colors hover:text-ink">
            {SUPPORT_EMAIL}
          </a>
        </div>
      </PageContainer>
    </footer>
  );
}
