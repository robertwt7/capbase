import { ImageResponse } from 'next/og';

import { loadOgFonts, OG, OG_SIZE, OgMark } from '@/lib/og';

export const alt = 'Capbase — free company and startup funding data';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: OG.paper,
          padding: 80,
        }}
      >
        <OgMark size={84} />

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontFamily: 'Archivo',
              fontSize: 112,
              fontWeight: 700,
              color: OG.ink,
              letterSpacing: '-0.03em',
            }}
          >
            Capbase
          </div>
          <div
            style={{
              marginTop: 20,
              fontFamily: 'IBM Plex Mono',
              fontSize: 28,
              letterSpacing: '0.08em',
              color: OG.graphite500,
            }}
          >
            FREE COMPANY & STARTUP FUNDING DATA
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            borderTop: `2px solid ${OG.line}`,
            paddingTop: 28,
            fontFamily: 'IBM Plex Mono',
            fontSize: 24,
            color: OG.graphite500,
          }}
        >
          <span>capbase.fyi</span>
          <span>OPEN · CROWDSOURCED</span>
        </div>
      </div>
    ),
    { ...size, fonts: await loadOgFonts() },
  );
}
