'use client';

import { useEffect, useRef, useState } from 'react';

interface CompanyLogoProps {
  name: string;
  domain: string;
  /** Pixel size of the square chip. */
  size?: number;
}

/** Same-origin logo proxy (app/api/logo/[domain]); lib/schema.ts mirrors it. */
const logoPath = (domain: string) => `/api/logo/${encodeURIComponent(domain)}`;

// Logos are the only color in the interface, so they carry weight. The monogram
// is always rendered underneath and the logo only fades in once it has actually
// loaded — so a missing logo never leaves an empty chip, even when the image
// fails during server render, before React could attach `onError`.
export function CompanyLogo({ name, domain, size = 44 }: CompanyLogoProps) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const monogram = name.charAt(0).toUpperCase();

  // The image may have settled before hydration; read its state directly.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-line bg-surface"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        className="font-display leading-none font-bold tracking-tight text-graphite-700"
        style={{ fontSize: size * 0.4 }}
      >
        {monogram}
      </span>
      {domain ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          className={`absolute inset-0 size-full bg-surface object-contain p-[18%] transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
          src={logoPath(domain)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onLoad={() => setLoaded(true)}
        />
      ) : null}
    </span>
  );
}
