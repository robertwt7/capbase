'use client';

import { useState } from 'react';

interface CompanyLogoProps {
  name: string;
  domain: string;
  /** Pixel size of the square chip. */
  size?: number;
}

// Logos are the only color in the interface, so they carry weight. We resolve a
// real mark from the company domain and fall back to a monogram chip if it fails
// to load, which keeps the grid intact when a logo is missing.
export function CompanyLogo({ name, domain, size = 44 }: CompanyLogoProps) {
  const [failed, setFailed] = useState(false);
  const monogram = name.charAt(0).toUpperCase();

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-line bg-surface"
      style={{ width: size, height: size }}
      aria-hidden={failed ? undefined : true}
    >
      {failed ? (
        <span
          className="font-display font-bold leading-none tracking-tight text-graphite-700"
          style={{ fontSize: size * 0.4 }}
        >
          {monogram}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="size-full object-contain p-[18%]"
          src={`https://logo.clearbit.com/${domain}`}
          alt={`${name} logo`}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
