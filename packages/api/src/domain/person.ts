// People as a first-class entity. The `Person` row is one human; `PersonRole` is
// one edge from that human to a company or an investor firm. The old child
// interface in `company.ts` (also called `Person`) is the SAME role row seen
// from a company profile, and keeps that name because a Citation anchors to it.

import type { EntityIdentifierRef } from './identifiers';
import type { Citation } from './provenance';

/**
 * What sort of role this is, when the source says so *structurally*.
 *
 * Populated only from a closed publisher vocabulary: Form D's `relationship`
 * enum (Executive Officer / Director / Promoter) and Wikidata's property
 * identity (P112 founder, P169 CEO). Null for Form C, whose roles are free
 * prose in a signature block, and for contributions — the same stance
 * `primarySector` takes on Form C's missing industry field. Never inferred by
 * reading a title string.
 */
export type RoleKind = 'Founder' | 'CEO' | 'Executive officer' | 'Director' | 'Promoter';

export const ROLE_KINDS: readonly RoleKind[] = [
  'Founder',
  'CEO',
  'Executive officer',
  'Director',
  'Promoter',
];

/** One role: this person, at this company or firm, in this capacity. */
export interface PersonRole {
  /** Row identity — what a Citation anchors to. */
  id: string;
  role: string;
  kind: RoleKind | null;
  title: string | null;
  since: number; // year the role started
  /** When the role ended, when the source dates it. Null means "no end
   *  recorded", which is not the same as "still there". */
  endYear: number | null;
  prior: string | null;
  linkedinUrl: string | null;
  /** Exactly one of these two is set. */
  company: { slug: string; name: string; domain: string | null } | null;
  investor: { slug: string; name: string } | null;
}

/** A human, deduplicated across every company and firm they appear at. */
export interface PersonSummary {
  id: string;
  slug: string;
  name: string;
  roleCount: number;
  companyCount: number;
  /** The companies/firms to show on a directory card, newest role first. */
  roles: PersonRole[];
}

/** Full profile: every role, not a sample, plus the crosswalk and the citations
 *  attesting the role rows. */
export interface PersonDetailResponse extends PersonSummary {
  identifiers: EntityIdentifierRef[];
  citations: Citation[];
  /** Whether search engines should index this profile (`indexing.ts`). The
   *  sitemap lists exactly the people for whom this is true. */
  indexable: boolean;
}

/**
 * Company legal forms, stripped from the end of a name.
 *
 * A person's name never ends in one, but the corpus is filings: a "related
 * person" occasionally IS a company, and stripping keeps this identical to the
 * company matcher's own key — which matters, because the two must never
 * disagree about a name they both see.
 */
const LEGAL_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'llc',
  'ltd',
  'limited',
  'co',
  'company',
  'plc',
  'sa',
  'ag',
]);

/**
 * The exact-equality dedup key for a human's name: lowercase, punctuation
 * stripped (so "Jane A. Smith" → "jane a smith"), trailing legal forms dropped,
 * whitespace collapsed.
 *
 * Lives here rather than in `apps/jobs` because BOTH write paths need it and
 * they must never drift: the ingest matcher stores it on `Person`, and the
 * moderation path looks a contributed name up by it. Two definitions would mean
 * a contributed "Jane Smith" quietly getting a second row.
 *
 * Note what it does NOT do. It keeps the middle name, so "Jane Smith" and
 * "Jane A. Smith" are different people here; collapsing them is a human's
 * decision, made through the merge queue.
 */
export function normalizePersonName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, '')
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(' ');
}

/** Lightweight listing entry for the web sitemap: every indexable person. */
export interface PersonSlugEntry {
  slug: string;
  updatedAt: string; // ISO timestamp of the row's last update
}
