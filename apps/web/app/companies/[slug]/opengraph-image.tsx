import { ImageResponse } from 'next/og';

import { getCompanyDetail } from '@/lib/data';
import { formatUsd } from '@/lib/format';
import { loadOgFonts, OG, OG_SIZE, OgMark } from '@/lib/og';

export const alt = 'Company funding profile on Capbase';
export const size = OG_SIZE;
export const contentType = 'image/png';

/** How many funding-ladder bars to draw at most. */
const MAX_BARS = 6;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Unknown slug → default branding, never throw (the page itself 404s).
  const result = await getCompanyDetail(slug).catch(() => undefined);
  const company = result?.company;
  const fonts = await loadOgFonts();

  if (!company) {
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
          <div
            style={{
              fontFamily: 'Archivo',
              fontSize: 96,
              fontWeight: 700,
              color: OG.ink,
              letterSpacing: '-0.03em',
            }}
          >
            Capbase
          </div>
          <div
            style={{
              borderTop: `2px solid ${OG.line}`,
              paddingTop: 28,
              fontFamily: 'IBM Plex Mono',
              fontSize: 24,
              color: OG.graphite500,
            }}
          >
            capbase.fyi
          </div>
        </div>
      ),
      { ...size, fonts },
    );
  }

  const rounds = (company.rounds ?? []).slice(-MAX_BARS);
  const maxAmount = Math.max(...rounds.map((r) => r.amountUsd), 1);
  const stats = [
    company.totalRaisedUsd > 0 ? `${formatUsd(company.totalRaisedUsd)} RAISED` : null,
    company.stage.toUpperCase(),
    `FOUNDED ${company.founded}`,
  ].filter((s): s is string => Boolean(s));
  const nameSize = company.name.length > 24 ? 56 : company.name.length > 14 ? 72 : 88;

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <OgMark size={40} />
            <span
              style={{
                fontFamily: 'IBM Plex Mono',
                fontSize: 24,
                letterSpacing: '0.1em',
                color: OG.graphite500,
              }}
            >
              CAPBASE
            </span>
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
            {company.name}
          </div>
          <div
            style={{
              marginTop: 18,
              fontFamily: 'IBM Plex Mono',
              fontSize: 26,
              color: OG.graphite700,
              maxWidth: 900,
            }}
          >
            {company.oneLiner}
          </div>
        </div>

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

        {rounds.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 28 }}>
            {rounds.map((round, i) => (
              <div
                key={`${round.name}-${i}`}
                style={{
                  height: 10,
                  width: 120 + 920 * (round.amountUsd / maxAmount),
                  background: OG.ink,
                  opacity: 0.25 + 0.75 * ((i + 1) / rounds.length),
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    ),
    { ...size, fonts },
  );
}
