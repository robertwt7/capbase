/**
 * The read gate's enforcement, in one place: every read that returns gated
 * data calls these, so a new read has one thing to call and one rule to obey.
 *
 * The policy (`@repo/api` visibility.ts, live via `GatePolicyService.current()`):
 *   - by section: `gateLimit(section, access, policy)` rows per section, and
 *     the section's `partnerAudience` decides whether the partner's ROWS are in
 *     its query (`publicRowsWhere`) and whether partner-corrected row columns
 *     are blanked (`gateRowFields`);
 *   - by field: every header fact has an audience and a partner audience
 *     (`gateFields`), which also locks the directory filters and sorts that
 *     match on it (`directoryFilters`);
 *   - by entity (fixed): partner-only ENTITIES are stubs signed out
 *     (`stubFor`) and absent from signed-out directories and search.
 *
 * Mappers stay pure: services map a row, then call these on the result.
 */
import {
  FIELD_REGISTRY,
  fieldGate,
  fieldInfo,
  fieldUnlockBy,
  isGatedField,
  meets,
  needsContributionLookup,
  partnerVisible,
  sectionPartnerRows,
  sectionPartnerUnlockBy,
  type DirectoryPage,
  type GatedEntity,
  type GatedSection,
  type GatePolicy,
  type SectionEntity,
  type UnlockBy,
  type ViewerAccess,
} from '@repo/api';

/** The ingest tag of the licensed partner. */
export const PARTNER_SOURCE = 'PARTNER';

/**
 * Blanks for fields whose domain type is not nullable. Anything not listed is
 * blanked to null. A masked numeric field must never read as a real figure, so
 * the web checks `masked` before rendering any value at all.
 */
export const COMPANY_BLANKS: Record<string, unknown> = {
  domain: '',
  hq: '',
  founded: 0,
  headcount: 0,
  industry: [],
  status: '',
  stage: '',
  totalRaisedUsd: 0,
  oneLiner: '',
  description: '',
};
export const INVESTOR_BLANKS: Record<string, unknown> = { type: '' };
export const ROUND_BLANKS: Record<string, unknown> = { name: '', date: '', amountUsd: 0, kind: 'Equity', currency: 'USD' };
export const FUND_BLANKS: Record<string, unknown> = { currency: 'USD' };

type Masks = { masked?: string[]; maskedUnlock?: Record<string, UnlockBy> };

/** Blank `fields` on `entity` unconditionally (the stub and the terms gate),
 *  merging into any `masked` list already there. With `unlock`, also records
 *  what reveals each (`maskedUnlock`). */
export function maskFields<T extends object>(
  entity: T,
  fields: readonly string[],
  blanks: Record<string, unknown> = {},
  unlock?: Record<string, UnlockBy>,
): T {
  const out = { ...entity } as Record<string, unknown> & Masks;
  const masked = new Set<string>(out.masked ?? []);
  const unlockBy: Record<string, UnlockBy> = { ...(out.maskedUnlock ?? {}) };
  for (const field of fields) {
    if (!(field in out)) continue;
    const blank = blanks[field];
    out[field] = Array.isArray(blank) ? [] : (blank ?? null);
    masked.add(field);
    const by = unlock?.[field];
    if (by) unlockBy[field] = by;
  }
  if (masked.size > 0) out.masked = [...masked];
  if (Object.keys(unlockBy).length > 0) out.maskedUnlock = unlockBy;
  return out as T;
}

/**
 * Withhold every field of `entity` this viewer may not see under the `kind`
 * field policy: a value hidden from the viewer's audience whoever wrote it, or
 * — when it is in `partnerFields` — one hidden below the partner audience. The
 * value is blanked, listed in `masked`, and `maskedUnlock` says what reveals
 * it. A field outside `FIELD_REGISTRY` keeps the fixed partner rule (blanked
 * signed out when the partner wrote it). Returns `entity` itself when nothing
 * is withheld.
 */
export function gateFields<T extends object>(
  kind: GatedEntity,
  entity: T,
  partnerFields: readonly string[] | null | undefined,
  access: ViewerAccess,
  policy: GatePolicy,
  blanks: Record<string, unknown> = {},
): T {
  const partner = new Set(partnerFields ?? []);
  const hide: string[] = [];
  const unlock: Record<string, UnlockBy> = {};
  const withhold = (field: string) => {
    hide.push(field);
    const registered = isGatedField(kind, field);
    unlock[field] = registered
      ? (fieldUnlockBy(policy, kind, field, access, partner.has(field)) ?? 'signIn')
      : 'signIn';
  };
  // The partner's fields first, in their stored order.
  for (const field of partner) {
    if (!(field in entity)) continue;
    if (fieldGate(policy, kind, field, access) !== 'show') withhold(field);
  }
  // Then any registered field hidden from this viewer whoever wrote it.
  for (const field of Object.keys(FIELD_REGISTRY[kind])) {
    if (!(field in entity) || hide.includes(field)) continue;
    if (fieldGate(policy, kind, field, access) === 'hide') withhold(field);
  }
  return hide.length ? maskFields(entity, hide, blanks, unlock) : entity;
}

/**
 * Blank the columns of one child row the partner corrected, when this viewer
 * may not see the section's partner data (the section's `partnerAudience`).
 */
export function gateRowFields<T extends object>(
  row: T,
  partnerFields: readonly string[] | null | undefined,
  access: ViewerAccess,
  policy: GatePolicy,
  section: GatedSection,
  blanks: Record<string, unknown> = {},
): T {
  if (!partnerFields?.length || sectionPartnerRows(policy, section, access)) return row;
  const by = sectionPartnerUnlockBy(policy, section, access) ?? 'signIn';
  const fields = partnerFields.filter((f) => f in row);
  if (!fields.length) return row;
  return maskFields(row, fields, blanks, Object.fromEntries(fields.map((f) => [f, by])));
}

/** Whether a value in `masked` was withheld (for server-side derivations). */
export const isMasked = (entity: { masked?: string[] }, field: string): boolean =>
  entity.masked?.includes(field) ?? false;

/** The provenance filter for rows that may be the partner's. */
type PublicRows = { OR?: ({ externalSource: null } | { externalSource: { not: string } })[] };

const NOT_PARTNER: Required<PublicRows> = {
  OR: [{ externalSource: null }, { externalSource: { not: PARTNER_SOURCE } }],
};

/**
 * The child-row filter of `section` for this viewer: every row when its
 * partner audience is met, else only rows the partner did not create. The `OR`
 * form on purpose — Prisma's `{ not: 'PARTNER' }` compiles to `<>`, which drops
 * the NULL-source rows (every contribution) along with the partner's. Spread
 * into a `where` that has no `OR` of its own; otherwise put it in an `AND`.
 */
export function publicRowsWhere(access: ViewerAccess, policy: GatePolicy, section: GatedSection): PublicRows {
  return sectionPartnerRows(policy, section, access) ? {} : NOT_PARTNER;
}

/** The same filter for the investors named on a round (`RoundInvestor`). */
export const visibleRoundInvestors = (access: ViewerAccess, policy: GatePolicy): PublicRows =>
  publicRowsWhere(access, policy, 'companyRounds');

/** Whether one row is visible under `publicRowsWhere` (for rows already loaded). */
export const rowVisible = (
  row: { externalSource: string | null },
  access: ViewerAccess,
  policy: GatePolicy,
  section: GatedSection,
): boolean => sectionPartnerRows(policy, section, access) || row.externalSource !== PARTNER_SOURCE;

/** Whether this viewer gets the stub of a partner-only entity (fixed rule). */
export const stubFor = (partnerOnly: boolean, access: ViewerAccess): boolean =>
  partnerOnly && !partnerVisible(access);

type Viewer = { role?: string } | null | undefined;

/**
 * The access a list read needs (directory lists, search, card samples) without
 * a contribution lookup: signed out, signed in, or — for a CONTRIBUTOR or
 * ADMIN, read off the role — unlocked. A signed-in USER is treated as locked;
 * use `listAccessFor` when the policy needs their contribution state. Never use
 * it for a read that calls `gateLimit`.
 */
export const listAccess = (viewer?: unknown, policy?: GatePolicy): ViewerAccess => {
  const role = (viewer as Viewer)?.role;
  const unlocked = role === 'ADMIN' || role === 'CONTRIBUTOR';
  return {
    unlocked,
    signedIn: Boolean(viewer),
    unlockedUntil: null,
    admin: role === 'ADMIN',
    windowDays: policy?.contributionWindowDays ?? 0,
  };
};

/**
 * `listAccess`, plus the contribution lookup (`accessFor`, nine indexed
 * `findFirst`s) for a signed-in USER — but only while some setting of the
 * listed entities has a `contributors` audience. Otherwise a list stays one
 * query for everyone.
 */
export async function listAccessFor<V extends { role: string }>(
  viewer: V | undefined,
  policy: GatePolicy,
  entities: SectionEntity | readonly SectionEntity[],
  accessFor: (viewer: V) => Promise<ViewerAccess>,
): Promise<ViewerAccess> {
  const quick = listAccess(viewer, policy);
  if (!viewer || quick.unlocked) return quick;
  const list = typeof entities === 'string' ? [entities] : entities;
  return list.some((e) => needsContributionLookup(policy, e)) ? accessFor(viewer) : quick;
}

/** What a directory read may apply for this viewer. */
export interface DirectoryGate {
  /** Whether to apply the filter `param` (false: the API ignores it). */
  use: (param: string) => boolean;
  /** For an `AND`: a filter on a partner-gated column never matches a value
   *  the partner wrote — the match itself would reveal it. */
  and: { NOT: { partnerFields: { has: string } } }[];
  /** Whether the sort `param` is locked (fall back to the default sort). */
  sortLocked: (param: string | undefined) => boolean;
  /** The locked params, for the response. */
  locked: DirectoryPage<never>['locked'];
}

/**
 * The directory filters and sorts of `entity` under the field policy:
 *   - a filter on a field this viewer may not see (`hide`) is ignored — and so
 *     is one on a partner-only column below its partner audience, where
 *     narrowing would match nothing; both are reported locked;
 *   - a filter on a field whose PARTNER value is hidden is narrowed to rows
 *     whose value the partner did not write (`and`);
 *   - a sort on a hidden field is locked (the caller falls back to its default
 *     sort). A sort on a partner-gated field keeps the accepted rank trade.
 * `applied`: which filter params the request carries.
 */
export function directoryFilters(
  policy: GatePolicy,
  entity: GatedEntity,
  access: ViewerAccess,
  applied: Record<string, boolean>,
): DirectoryGate {
  const ignored = new Set<string>();
  const sorts = new Set<string>();
  const unlockBy: Record<string, UnlockBy> = {};
  const and: DirectoryGate['and'] = [];
  const strongest = (a: UnlockBy | undefined, b: UnlockBy): UnlockBy => (a === 'contribute' ? a : b);

  for (const field of Object.keys(FIELD_REGISTRY[entity])) {
    const info = fieldInfo(entity, field)!;
    const gate = fieldGate(policy, entity, field, access);
    if (info.filter) {
      if (gate === 'hide' || (gate === 'hidePartner' && info.partnerOnlyColumn)) {
        ignored.add(info.filter);
        unlockBy[info.filter] = fieldUnlockBy(policy, entity, field, access, gate === 'hidePartner') ?? 'signIn';
      } else if (gate === 'hidePartner' && applied[info.filter]) {
        and.push({ NOT: { partnerFields: { has: field } } });
      }
    }
    if (info.sort && gate === 'hide') {
      sorts.add(info.sort);
      unlockBy[info.sort] = strongest(
        unlockBy[info.sort],
        fieldUnlockBy(policy, entity, field, access, false) ?? 'signIn',
      );
    }
  }
  return {
    use: (param) => !ignored.has(param),
    and,
    sortLocked: (param) => param !== undefined && sorts.has(param),
    locked: { filters: [...ignored], sorts: [...sorts], unlockBy },
  };
}

/** Whether this viewer may see a registered field's value at all (`hide` is
 *  the only outcome that withholds a value whoever wrote it). */
export const fieldVisible = (policy: GatePolicy, entity: GatedEntity, field: string, access: ViewerAccess): boolean =>
  fieldGate(policy, entity, field, access) !== 'hide';

/** Whether this viewer may see the partner's value of a field. */
export const partnerFieldVisible = (
  policy: GatePolicy,
  entity: GatedEntity,
  field: string,
  access: ViewerAccess,
): boolean => fieldGate(policy, entity, field, access) === 'show';

/** Whether the viewer meets an audience (re-exported for services). */
export { meets };

/** Slice to a gate limit (`Infinity` keeps everything). */
export const limitRows = <T>(rows: T[], limit: number): T[] =>
  Number.isFinite(limit) ? rows.slice(0, limit) : rows;

/** A Prisma `take` for a gate limit: undefined (no limit) when unlimited. */
export const takeFor = (limit: number): number | undefined => (Number.isFinite(limit) ? limit : undefined);
