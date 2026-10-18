/**
 * The read gate's enforcement, in one place: every read that returns gated
 * data calls these, so a new read has one thing to call and one rule to obey.
 *
 * Two rules (the policy itself lives in `@repo/api` `contributions.ts`):
 *   - by section: `gateLimit(section, access)` rows per section;
 *   - by provenance: partner data never reaches a signed-out viewer — partner
 *     ROWS are filtered out of child queries (`publicRowsWhere`), partner
 *     FIELDS are blanked on every entity (`maskPartnerFields`), and partner-only
 *     ENTITIES become stubs.
 *
 * Mappers stay pure: services map a row, then call these on the result.
 */
import { partnerVisible, type ViewerAccess } from '@repo/api';

/** The ingest tag of the licensed partner. */
export const PARTNER_SOURCE = 'PARTNER';

/**
 * Blanks for fields whose domain type is not nullable. Anything not listed is
 * blanked to null. A masked numeric field must never read as a real figure, so
 * the web checks `masked` before rendering any value at all.
 */
export const COMPANY_BLANKS: Record<string, unknown> = {
  domain: '',
  oneLiner: '',
  description: '',
  hq: '',
  founded: 0,
  headcount: 0,
  industry: [],
  status: '',
  stage: '',
  totalRaisedUsd: 0,
};
export const INVESTOR_BLANKS: Record<string, unknown> = { type: '' };
export const ROUND_BLANKS: Record<string, unknown> = { name: '', date: '', amountUsd: 0, kind: 'Equity', currency: 'USD' };
export const FUND_BLANKS: Record<string, unknown> = { currency: 'USD' };

/**
 * Withhold every field in `partnerFields` that `entity` carries, when this
 * viewer may not see partner data: the value is blanked and the field listed
 * in `masked`. A no-op (the same object, untouched) for a signed-in viewer.
 */
export function maskPartnerFields<T extends object>(
  entity: T,
  partnerFields: readonly string[] | null | undefined,
  access: ViewerAccess,
  blanks: Record<string, unknown> = {},
): T {
  if (partnerVisible(access) || !partnerFields?.length) return entity;
  return maskFields(entity, partnerFields, blanks);
}

/** Blank `fields` on `entity` unconditionally (the stub and the terms gate),
 *  merging into any `masked` list already there. */
export function maskFields<T extends object>(
  entity: T,
  fields: readonly string[],
  blanks: Record<string, unknown> = {},
): T {
  const out = { ...entity } as Record<string, unknown>;
  const masked = new Set<string>((out.masked as string[] | undefined) ?? []);
  for (const field of fields) {
    if (!(field in out)) continue;
    const blank = blanks[field];
    out[field] = Array.isArray(blank) ? [] : (blank ?? null);
    masked.add(field);
  }
  if (masked.size > 0) out.masked = [...masked];
  return out as T;
}

/** Whether a value in `masked` was withheld (for server-side derivations). */
export const isMasked = (entity: { masked?: string[] }, field: string): boolean =>
  entity.masked?.includes(field) ?? false;

/**
 * The child-row filter for this viewer: every row when partner data is
 * visible, else only rows the partner did not create. The `OR` form on
 * purpose — Prisma's `{ not: 'PARTNER' }` compiles to `<>`, which drops the
 * NULL-source rows (every contribution) along with the partner's. Spread into a
 * `where` that has no `OR` of its own; otherwise put it in an `AND`.
 */
export function publicRowsWhere(access: ViewerAccess): {
  OR?: ({ externalSource: null } | { externalSource: { not: string } })[];
} {
  if (partnerVisible(access)) return {};
  return { OR: [{ externalSource: null }, { externalSource: { not: PARTNER_SOURCE } }] };
}

/** The same filter for the investors named on a round (`RoundInvestor`). */
export const visibleRoundInvestors = publicRowsWhere;

/** Whether one row is visible under `publicRowsWhere` (for rows already loaded). */
export const rowVisible = (row: { externalSource: string | null }, access: ViewerAccess): boolean =>
  partnerVisible(access) || row.externalSource !== PARTNER_SOURCE;

/** Whether this viewer gets the stub of a partner-only entity. */
export const stubFor = (partnerOnly: boolean, access: ViewerAccess): boolean =>
  partnerOnly && !partnerVisible(access);

/**
 * The access a read needs when it applies the provenance rule only (directory
 * lists, search): `partnerVisible` depends on nothing but whether the viewer is
 * signed in, so no contribution lookup — a list stays one query for everyone.
 * Never use it for a read that calls `gateLimit`.
 */
export const listAccess = (viewer?: unknown): ViewerAccess => ({
  unlocked: false,
  signedIn: Boolean(viewer),
  unlockedUntil: null,
});

/**
 * Directory-filter conditions for signed-out viewers: a filter on column `X`
 * must never match a row whose `X` the partner wrote (the match itself would
 * reveal the value). For an `AND`; empty when partner data is visible.
 */
export function unmaskedFilters(
  access: ViewerAccess,
  columns: readonly (string | false | undefined | null)[],
): { NOT: { partnerFields: { has: string } } }[] {
  if (partnerVisible(access)) return [];
  return columns
    .filter((c): c is string => typeof c === 'string')
    .map((c) => ({ NOT: { partnerFields: { has: c } } }));
}

/** Slice to a gate limit (`Infinity` keeps everything). */
export const limitRows = <T>(rows: T[], limit: number): T[] =>
  Number.isFinite(limit) ? rows.slice(0, limit) : rows;

/** A Prisma `take` for a gate limit: undefined (no limit) when unlocked. */
export const takeFor = (limit: number): number | undefined => (Number.isFinite(limit) ? limit : undefined);
