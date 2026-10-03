// Shared pieces for the next/og ImageResponse routes (app/opengraph-image.tsx
// and app/companies/[slug]/opengraph-image.tsx).
//
// Fonts are vendored OFL .ttf files loaded via readFile(new URL(...,
// import.meta.url)): the bundler rewrites the URL to the emitted asset and
// traces it into the standalone Docker output — never fs + process.cwd()
// (untraced, breaks in the standalone server) and never fetch (undici refuses
// the file: URLs the bundler produces).
//
// Colors are literal values from the globals.css graphite ramp — ImageResponse
// renders outside the DOM, so CSS variables are unavailable by design.

import { readFile } from 'node:fs/promises';

import { MARK_PATH, MARK_VIEWBOX, WORDMARK_PATH } from '@/components/Logo';

export const OG = {
  ink: '#141210',
  paper: '#f0ece3',
  graphite700: '#4a453d',
  graphite500: '#6e675c',
  line: '#ded8cc',
} as const;

export const OG_SIZE = { width: 1200, height: 630 };

export async function loadOgFonts() {
  const [archivo, plexMono] = await Promise.all([
    readFile(new URL('../assets/fonts/Archivo-Bold.ttf', import.meta.url)),
    readFile(new URL('../assets/fonts/IBMPlexMono-Regular.ttf', import.meta.url)),
  ]);
  return [
    { name: 'Archivo', data: archivo, weight: 700 as const, style: 'normal' as const },
    { name: 'IBM Plex Mono', data: plexMono, weight: 400 as const, style: 'normal' as const },
  ];
}

/** The cap brand mark, `size` px wide (Satori renders inline SVG). */
export function OgMark({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 250) / 370} viewBox={MARK_VIEWBOX}>
      <path fill={OG.ink} fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}

/** The `capbase` wordmark alone, `height` px tall. */
export function OgWordmark({ height = 64 }: { height?: number }) {
  return (
    <svg width={(height * 1006) / 250} height={height} viewBox="400 0 1006 250">
      <path fill={OG.ink} fillRule="evenodd" d={WORDMARK_PATH} />
    </svg>
  );
}
