import { ImageResponse } from 'next/og';

import { getInvestor } from '@/lib/data';
import { formatCount, formatUsd } from '@/lib/format';
import { loadOgFonts, OG, OG_SIZE, OgFallbackCard, OgMark, OgWordmark } from '@/lib/og';

export const alt = 'Investor profile on Capbase';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Unknown slug → default branding, never throw (the page itself 404s). The
  // `.catch` also swallows the merged-slug redirect signal — see the identical
  // note on the company card.
  const investor = await getInvestor(slug).catch(() => null);
  const fonts = await loadOgFonts();

  if (!investor) return new ImageResponse(<OgFallbackCard />, { ...size, fonts });

  const meta = [investor.type, investor.hq].filter(Boolean).join(' · ');
  // Investors have no rounds, so no ladder: the stat row is the whole story,
  // and each stat appears only when it says something.
  const stats = [
    investor.assetsUsd ? `${formatUsd(investor.assetsUsd)} FUND ASSETS` : null,
    investor.portfolioCount > 0 ? `${formatCount(investor.portfolioCount)} PORTFOLIO` : null,
    investor.namedFundCount > 0 ? `${formatCount(investor.namedFundCount)} FUNDS` : null,
  ].filter((s): s is string => Boolean(s));
  // Form ADV legal names run long ("… Management, L.P."), hence the extra step
  // below the company card's three.
  const n = investor.name.length;
  const nameSize = n > 40 ? 48 : n > 24 ? 56 : n > 14 ? 72 : 88;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: OG.paper,
          padding: 72,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <OgMark size={52} />
            <OgWordmark height={30} />
          </div>
          <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 22, color: OG.graphite500 }}>
            capbase.fyi
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
          <div
            style={{
              fontFamily: 'Archivo',
              fontSize: nameSize,
              fontWeight: 700,
              color: OG.ink,
              letterSpacing: '-0.03em',
              lineHeight: 1.02,
            }}
          >
            {investor.name}
          </div>
          {meta ? (
            <div
              style={{
                marginTop: 18,
                fontFamily: 'IBM Plex Mono',
                fontSize: 26,
                color: OG.graphite700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                maxWidth: 900,
              }}
            >
              {meta}
            </div>
          ) : null}
        </div>

        {stats.length > 0 ? (
          <div
            style={{
              display: 'flex',
              gap: 40,
              marginTop: 40,
              borderTop: `2px solid ${OG.line}`,
              paddingTop: 26,
              fontFamily: 'IBM Plex Mono',
              fontSize: 24,
              color: OG.ink,
              letterSpacing: '0.04em',
            }}
          >
            {stats.map((stat, i) => (
              <span key={stat} style={{ display: 'flex', gap: 40 }}>
                {i > 0 ? <span style={{ color: OG.graphite500 }}>·</span> : null}
                {stat}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    ),
    { ...size, fonts },
  );
}
