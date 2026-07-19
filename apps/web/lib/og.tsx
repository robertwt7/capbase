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

export const OG = {
  ink: '#0e0e10',
  paper: '#fbfbfc',
  graphite700: '#3a3a40',
  graphite500: '#75757e',
  line: '#e6e6ea',
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

/** The stepped-corner brand mark, built from two rects (no clip-path needed). */
export function OgMark({ size = 72 }: { size?: number }) {
  const step = size * 0.6;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: size, height: size }}>
      <div style={{ width: size, height: step, background: OG.ink }} />
      <div style={{ width: step, height: size - step, background: OG.ink }} />
    </div>
  );
}
