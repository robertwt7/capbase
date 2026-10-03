import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

import { ConsentBanner } from '@/components/ConsentBanner';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import './globals.css';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-archivo',
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Capbase — Free Company & Startup Funding Data',
    template: `%s — ${SITE_NAME}`,
  },
  description:
    'Funding rounds, investors, people, and market data for private companies — a free, crowdsourced, open-source alternative to Crunchbase and PitchBook.',
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    url: '/',
  },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read server-side at runtime (this is an RSC), so no Docker build arg is
  // needed; unset in dev → GA and its consent banner are a silent no-op. GA
  // itself only loads once the visitor accepts (ConsentBanner).
  const gaId = process.env.NEXT_PUBLIC_GA_ID;

  return (
    <html lang="en">
      <body
        className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} antialiased`}
      >
        <a
          href="#content"
          className="sr-only z-50 rounded-sm bg-primary px-4 py-2 font-sans text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <SiteHeader />
        {/* The one <main> landmark: pages render plain containers inside it. */}
        <main id="content" tabIndex={-1} className="outline-none">
          {children}
        </main>
        <SiteFooter showCookiePreferences={Boolean(gaId)} />
        <ConsentBanner gaId={gaId} />
      </body>
    </html>
  );
}
