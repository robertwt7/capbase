import { kebab } from '../util/slug';

/** Path segments the funds router answers itself; a fund may never take one. */
const RESERVED_FUND_SLUGS = new Set(['sitemap']);

/**
 * A slug for a fund page that no other fund holds, registered in `slugs`.
 *
 * The name first; then the name plus the source's own id, which is stable
 * across rebuilds; then a counter. Shared by ingest (on create) and the
 * `backfill-fund-slugs` CLI, so both mint the same shape.
 */
export function uniqueFundSlug(name: string, discriminator: string | null, slugs: Set<string>): string {
  const raw = kebab(name);
  const base = raw === 'company' && !/company/i.test(name) ? 'fund' : raw;
  const taken = (s: string) => slugs.has(s) || RESERVED_FUND_SLUGS.has(s);

  let candidate = base;
  if (taken(candidate) && discriminator) candidate = `${base}-${kebab(discriminator)}`;
  for (let n = 2; taken(candidate); n++) candidate = `${base}-${n}`;
  slugs.add(candidate);
  return candidate;
}

/** A fund still waiting for a slug, as the backfill reads it. */
export interface UnsluggedFund {
  id: string;
  name: string;
  externalId: string | null;
}

/**
 * Slugs for a page of unslugged funds, unique against every slug already in
 * `slugs` (which it extends). Pure, so the backfill's uniqueness is testable
 * without a database.
 */
export function planFundSlugs(rows: UnsluggedFund[], slugs: Set<string>): { id: string; slug: string }[] {
  return rows.map((r) => ({ id: r.id, slug: uniqueFundSlug(r.name, r.externalId, slugs) }));
}
