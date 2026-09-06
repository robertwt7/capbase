/**
 * The pure half of person deduplication: how a role row resolves to a human,
 * and which spelling variants a moderator should decide on.
 *
 * Separate from the `backfill-people` CLI so it can be tested without booting a
 * Nest context — importing the CLI runs it, the same reason `merge-detector.ts`
 * exists.
 */

import { normalizeIdentifier, normalizePersonName } from '@repo/api';

import { kebab } from '../util/slug';

/** The Wikidata source's provenance tag, repeated here rather than imported so
 *  this module stays free of the source tree. */
const WIKIDATA = 'WIKIDATA';

/**
 * Personal name suffixes, dropped before taking a "last name".
 *
 * Without this, "Adam Larson Jr" keys on `adam jr` and never meets
 * "Adam J. Larson" — the exact case the variant sweep exists to find.
 */
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'md', 'phd', 'mba', 'esq']);

/** One role row as the matcher sees it. */
export interface BackfillRole {
  id: string;
  name: string;
  /** The organisation the role is at — a company or an investor firm. Only used
   *  to scope the variant sweep, which asks "two spellings at one org". */
  orgId: string | null;
  externalSource: string | null;
  externalId: string | null;
  /** Already resolved by an earlier run; such a row is left completely alone. */
  personId: string | null;
  approved: boolean;
}

/** A `Person` row this run will create, with the roles that will point at it. */
export interface NewPerson {
  /** Placeholder identity, valid only within one plan. The CLI swaps it for the
   *  real cuid once the row is written. */
  ref: string;
  slug: string;
  name: string;
  normalizedName: string;
  /** The Wikidata QID that identified this human, when one did. */
  qid: string | null;
  /** A person is public exactly when something public references them. */
  approved: boolean;
  roleIds: string[];
}

export interface Assignment {
  created: NewPerson[];
  /** roleId → the id of a person that already existed before this run. */
  attached: Map<string, string>;
  /** roleId → `NewPerson.ref`, for the rows this run creates a person for. */
  assignedRefs: Map<string, string>;
  /** Rows that already carried a personId, so nothing was done to them. */
  skipped: number;
  /** Rows whose name normalizes to nothing — no identity can be minted from a
   *  blank, so they are counted and left unresolved rather than given one. */
  unusable: number;
  /** Rows left unresolved because the human asked to be removed. */
  suppressed: number;
  /** Wikidata rows whose embedded QID failed validation and therefore fell
   *  through to the name pass, exactly as a malformed identifier does
   *  everywhere else: counted and dropped, never stored. */
  malformedQids: number;
}

/** What the matcher already holds before this run starts. */
export interface ExistingPeople {
  /** normalized QID → person id (from EntityIdentifier). */
  byQid: Map<string, string>;
  /** normalizePersonName(name) → person id. */
  byName: Map<string, string>;
  /** Every person slug in use, so new ones are unique without extra queries. */
  slugs: Set<string>;
  /**
   * Normalized names of people removed on request.
   *
   * They are absent from `byName` (matching one would revive them), so without
   * this set the name pass would simply mint a SECOND row for the same human —
   * which is worse. The same guard `loadPersonIndex` applies in ingest, for the
   * same reason: this backfill is a step of `ingest-all`, so a rebuild would
   * otherwise undo every removal request.
   */
  suppressed: Set<string>;
}

/**
 * The person QID a Wikidata role row carries, or null.
 *
 * `wikidata.mapper` mints the externalId as
 * `${companyQid}:person:${personQid}:${role}`, so the human's own identifier is
 * already stored on every such row and is recoverable with no network access —
 * the same trick `backfill-citations` uses to rebuild every URL from stored
 * identifiers. A value that fails `normalizeIdentifier` yields null: a
 * malformed identifier in the crosswalk would join two unrelated people.
 */
export function personQid(source: string | null, externalId: string | null): string | null {
  if (source !== WIKIDATA || !externalId) return null;
  const parts = externalId.split(':');
  if (parts.length < 3 || parts[1] !== 'person') return null;
  return normalizeIdentifier('WIKIDATA', parts[2]!);
}

/**
 * The variant sweep's key: first and last name only, at one organisation.
 *
 * Deliberately LOOSER than the matcher's own key, for the same reason the
 * company detector's is — a sweep keyed on what the matcher matches finds
 * nothing by construction. Here the looseness is along a different axis:
 * `normalizePersonName` keeps the middle name, so "Adam Larson" and
 * "Adam J. Larson" never meet; this key drops it, and the pair goes to a human
 * instead of being merged automatically.
 */
export function nameVariantKey(name: string): string {
  const tokens = normalizePersonName(name).split(' ').filter(Boolean);
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  if (tokens.length === 0) return '';
  if (tokens.length === 1) return tokens[0]!;
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

/** `jane-smith`, then `jane-smith-2`, … — the same collision handling companies
 *  and investors use, minus the externalId disambiguator a person has none of. */
export function uniquePersonSlug(name: string, taken: Set<string>): string {
  const base = kebab(name);
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Resolve every role row to a human: identifier first, then exact normalized
 * name.
 *
 * The order is the point. A QID is a statement by the publisher about WHICH
 * human this is; an exactly-equal name is a much weaker claim. Running the
 * identifier pass first means a person whose QID is known keeps that identity
 * and merely absorbs the name-keyed rows, rather than a name-keyed person being
 * created first and the QID landing on a second row.
 *
 * Nothing looser than exact equality runs here. Spelling variants are found by
 * `variantPairs` and decided by a human.
 */
export function assignPeople(roles: BackfillRole[], existing: ExistingPeople): Assignment {
  const created: NewPerson[] = [];
  const attached = new Map<string, string>();
  const assignedRefs = new Map<string, string>();
  const byRef = new Map<string, NewPerson>();
  // Minted this run, so a second role in the same pass lands on the same person
  // without a re-query — the pattern the ingest match index already follows.
  const newByQid = new Map<string, string>();
  const newByName = new Map<string, string>();
  const slugs = new Set(existing.slugs);

  let skipped = 0;
  let unusable = 0;
  let suppressed = 0;
  let malformedQids = 0;

  const create = (role: BackfillRole, qid: string | null, norm: string): NewPerson => {
    const person: NewPerson = {
      ref: `new:${created.length}`,
      slug: uniquePersonSlug(role.name, slugs),
      name: role.name,
      normalizedName: norm,
      qid,
      approved: false,
      roleIds: [],
    };
    created.push(person);
    byRef.set(person.ref, person);
    if (qid) newByQid.set(qid, person.ref);
    // Register the name too, so the name pass absorbs into this identity rather
    // than minting a second person for the same human.
    if (norm && !newByName.has(norm)) newByName.set(norm, person.ref);
    return person;
  };

  const attach = (role: BackfillRole, target: string): void => {
    const person = byRef.get(target);
    if (person) {
      person.roleIds.push(role.id);
      person.approved ||= role.approved;
      assignedRefs.set(role.id, target);
    } else {
      attached.set(role.id, target);
    }
  };

  // --- Pass 1: identifier ---------------------------------------------------
  const remaining: BackfillRole[] = [];
  for (const role of roles) {
    if (role.personId) {
      skipped++;
      continue;
    }
    const qid = personQid(role.externalSource, role.externalId);
    if (!qid) {
      if (role.externalSource === WIKIDATA && role.externalId) malformedQids++;
      remaining.push(role);
      continue;
    }
    const known = existing.byQid.get(qid) ?? newByQid.get(qid);
    if (known) {
      attach(role, known);
      continue;
    }
    const norm = normalizePersonName(role.name);
    if (existing.suppressed.has(norm)) {
      suppressed++;
      continue;
    }
    const person = create(role, qid, norm);
    attach(role, person.ref);
  }

  // --- Pass 2: exact normalized name ---------------------------------------
  for (const role of remaining) {
    const norm = normalizePersonName(role.name);
    if (!norm) {
      unusable++;
      continue;
    }
    if (existing.suppressed.has(norm)) {
      suppressed++;
      continue;
    }
    const known = existing.byName.get(norm) ?? newByName.get(norm);
    if (known) {
      attach(role, known);
      continue;
    }
    const person = create(role, null, norm);
    attach(role, person.ref);
  }

  return { created, attached, assignedRefs, skipped, unusable, suppressed, malformedQids };
}

/** A variant pair the sweep wants a human to decide. */
export interface VariantPair {
  aId: string;
  bId: string;
  /** The shared key, shown to the reviewer so they can check the proposal
   *  rather than guess why it was made. */
  evidence: string;
}

export interface VariantResult {
  pairs: VariantPair[];
  /** Groups too large to be credible duplicates, with their key and size. */
  skipped: { key: string; size: number }[];
}

/** One role, once it knows which person it belongs to. */
export interface AssignedRole {
  personId: string;
  orgId: string | null;
  name: string;
}

/**
 * Pairs of DIFFERENT people who share a first and last name at one
 * organisation — the middle-initial and casing variants exact equality will not
 * merge.
 *
 * Bounded by the same `groupLimit` the company sweep uses: a key shared by many
 * people is a common name, not that many duplicates, and emitting every pair
 * from a group of n costs n(n-1)/2 rows in front of a moderator.
 */
export function variantPairs(
  roles: AssignedRole[],
  groupLimit: number,
): VariantResult {
  const groups = new Map<string, Set<string>>();
  for (const role of roles) {
    // A role with no organisation cannot be scoped, and an unkeyable name is
    // "not recorded", not a name two rows have in common.
    if (!role.orgId) continue;
    const key = nameVariantKey(role.name);
    if (!key) continue;
    const full = `${role.orgId}|${key}`;
    const set = groups.get(full);
    if (set) set.add(role.personId);
    else groups.set(full, new Set([role.personId]));
  }

  const pairs: VariantPair[] = [];
  const skipped: { key: string; size: number }[] = [];

  for (const [full, people] of groups) {
    if (people.size < 2) continue;
    // The org id is a cuid and means nothing to a reviewer; the name is the
    // evidence.
    const evidence = full.slice(full.indexOf('|') + 1);
    if (people.size > groupLimit) {
      skipped.push({ key: evidence, size: people.size });
      continue;
    }
    const ids = [...people];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        pairs.push({ aId: ids[i]!, bId: ids[j]!, evidence });
      }
    }
  }

  return { pairs, skipped };
}
