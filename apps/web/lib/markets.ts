// Sector <-> URL slug mapping. Sector values contain spaces (e.g. "Artificial
// intelligence"), so /markets/[sector] uses a slug rather than the raw value.
// `labelSlug` is shared with the API (vertical slugs, the markets sitemap), so the
// two always build the same URLs.

import { labelSlug, SECTORS, type Sector } from '@repo/api';

export const sectorSlug = labelSlug;

export const sectorFromSlug = (slug: string): Sector | undefined =>
  SECTORS.find((s) => sectorSlug(s) === slug);
