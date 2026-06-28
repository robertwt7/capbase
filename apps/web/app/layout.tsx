import type { Metadata } from 'next';
import { IBM_Plex_Mono, Inter } from 'next/font/google';

import { SiteHeader } from '../components/SiteHeader';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  title: 'Capbase — open company and funding intelligence',
  description:
    'Funding rounds, investors, people, and market data for private companies. An open alternative to closed deal databases.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${plexMono.variable}`}>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
