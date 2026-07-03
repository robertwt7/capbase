// Sector <-> URL slug mapping. Sector values contain spaces (e.g. "Artificial
// intelligence"), so /markets/[sector] uses a slug rather than the raw value.

import { SECTORS, type Sector } from '@repo/api';

export const sectorSlug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const sectorFromSlug = (slug: string): Sector | undefined =>
  SECTORS.find((s) => sectorSlug(s) === slug);
