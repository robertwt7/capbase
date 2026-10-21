'use client';

import QRCode from 'qrcode';
import { useMemo } from 'react';

import { cn } from '@/lib/utils';

/** Light modules around the code, which scanners need to find its edges. */
const QUIET_ZONE = 4;

/**
 * A QR code drawn as SVG in the ink colour on the surface — never `toDataURL`, which bakes in
 * black on pure white. Dark modules on one row are merged into runs, so a code is a few hundred
 * rects rather than a few thousand.
 */
export function QrCode({
  value,
  label = 'QR code for your authenticator app',
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const { size, runs } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const out: { x: number; y: number; w: number }[] = [];
    for (let y = 0; y < modules.size; y++) {
      let start = -1;
      for (let x = 0; x <= modules.size; x++) {
        const dark = x < modules.size && modules.get(y, x) === 1;
        if (dark && start === -1) start = x;
        if (!dark && start !== -1) {
          out.push({ x: start, y, w: x - start });
          start = -1;
        }
      }
    }
    return { size: modules.size, runs: out };
  }, [value]);

  const box = size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${box} ${box}`}
      shapeRendering="crispEdges"
      className={cn('rounded-md border border-line bg-surface fill-current text-ink', className)}
    >
      {runs.map((r) => (
        <rect key={`${r.y}-${r.x}`} x={r.x + QUIET_ZONE} y={r.y + QUIET_ZONE} width={r.w} height={1} />
      ))}
    </svg>
  );
}
