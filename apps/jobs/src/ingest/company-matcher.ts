/**
 * The company identity policy: which existing row (if any) one source company
 * record is, decided from evidence alone, with no database access — so every
 * branch is testable without a Prisma mock.
 *
 * The rules, strongest first:
 *
 *  1. A private hold (`CompanyIngestBinding` REVIEW_REQUIRED) on the record
 *     stops it: nothing about the company or its children is written.
 *  2. The record's own provenance key routes to the row it created (or that
 *     row's merge survivor). A source is authoritative for its own row.
 *  3. A RESOLVED binding routes to the company it names.
 *  4. Legal identifiers (CIK, QID, CRD, Companies House …) must agree: two
 *     companies → conflict, the record is skipped and a hold recorded.
 *  5. A hit on a source's OWN record-id scheme (the partner's company id) that
 *     no binding confirms is a legacy alias — possibly attached by a name
 *     match — and cannot vouch for itself: held until the repair audit
 *     certifies or splits it.
 *  6. A domain held by exactly one company may associate, unless that company
 *     already holds a different record of the same source (the publisher says
 *     they are two entities), a different Companies House number, or a legacy
 *     alias nobody has certified. A domain held by several rows is not
 *     first-wins: it associates with none.
 *  7. Otherwise create a new, source-keyed company. An equal name is never
 *     enough to combine: it only proposes a bounded merge candidate.
 */
import { createHash } from 'node:crypto';

/** Bumped whenever a rule above changes; stored on every binding it writes. */
export const COMPANY_MATCH_POLICY_VERSION = 1;

/** Schemes that are a source's OWN record id (see ingest.service.ts). The
 *  scheme is named after the source that owns it. */
export const RECORD_ID_SCHEMES: ReadonlySet<string> = new Set(['PARTNER']);

/** Name twins are only proposed for review when there are at most this many:
 *  a common name ("Acme") is not that many duplicates. */
export const NAME_CANDIDATE_LIMIT = 3;

export type BindingStatus = 'RESOLVED' | 'REVIEW_REQUIRED';

/** A binding as the matcher reads it (company id already survivor-resolved). */
export interface BindingView {
  companyId: string | null;
  status: BindingStatus;
}

/** What the matcher knows about one candidate company. */
export interface CandidateEvidence {
  id: string;
  /** Live and approved-or-ingested (not merged away to nowhere). */
  live: boolean;
  externalSource: string | null;
  externalId: string | null;
  /** `${scheme}:${value}` for every record-id identifier the row holds. */
  recordIds: string[];
  /** Record-id identifiers on this row that no RESOLVED binding confirms and
   *  that are not the row's own provenance key: uncertified legacy aliases. */
  unresolvedAliases: string[];
  /** The Companies House number the row holds, if any. */
  companyNumber: string | null;
  countryCode: string | null;
}

export interface MatchInput {
  source: string;
  sourceCompanyId: string;
  /** Own provenance key → company (survivor-resolved), if any. */
  ownCompanyId: string | null;
  binding: BindingView | null;
  /** Companies each legal identifier on the record resolves to, keyed by
   *  `${scheme}:${value}`. Record-id schemes are passed separately. */
  legalHits: Map<string, string>;
  /** Companies the record's own record-id identifiers resolve to. */
  recordHits: Map<string, string>;
  /** Every live company holding the record's domain (column or identifier). */
  domainHolders: string[];
  /** The record's Companies House number, normalized. */
  companyNumber: string | null;
  /** Evidence for every company id mentioned above. */
  candidates: Map<string, CandidateEvidence>;
}

export type MatchMethod = 'own' | 'binding' | 'identifier' | 'record' | 'domain';

export type CompanyMatch =
  /** Write to this company. */
  | { kind: 'existing'; companyId: string; method: MatchMethod }
  /** Create a new source-keyed company. */
  | { kind: 'create'; reason: string }
  /** The evidence disagrees: skip the record, record a private hold. */
  | { kind: 'conflict'; reason: string; companyIds: string[] }
  /** A legacy association nobody has certified: skip the record, count it.
   *  Not written as a binding — the repair audit decides. */
  | { kind: 'hold'; reason: string; companyIds: string[] };

const unique = (ids: Iterable<string>) => [...new Set(ids)].sort();

/** The country rule shared by name-twin proposals and the merge detector:
 *  equal, or unknown on either side. */
export function countriesCompatible(a: string | null, b: string | null): boolean {
  return !a || !b || a === b;
}

/** Whether `c` already holds a different record of `source` than this one. */
export function holdsOtherRecord(c: CandidateEvidence, source: string, sourceCompanyId: string): boolean {
  if (c.externalSource === source && c.externalId && c.externalId !== sourceCompanyId) return true;
  if (!RECORD_ID_SCHEMES.has(source)) return false;
  const mine = `${source}:${sourceCompanyId}`;
  return c.recordIds.some((k) => k.startsWith(`${source}:`) && k !== mine);
}

export function decideCompanyMatch(m: MatchInput): CompanyMatch {
  // 1. An explicit hold wins over every route, own key included.
  if (m.binding?.status === 'REVIEW_REQUIRED') {
    return { kind: 'hold', reason: 'review-required', companyIds: m.binding.companyId ? [m.binding.companyId] : [] };
  }

  // 2. Our own row.
  if (m.ownCompanyId) return { kind: 'existing', companyId: m.ownCompanyId, method: 'own' };

  // 3. A routing decision ingest or a reviewed repair already established.
  if (m.binding?.status === 'RESOLVED' && m.binding.companyId) {
    const c = m.candidates.get(m.binding.companyId);
    if (c?.live) return { kind: 'existing', companyId: c.id, method: 'binding' };
    return { kind: 'hold', reason: 'binding-target-gone', companyIds: [m.binding.companyId] };
  }

  // 4. Legal identifiers: all must name one company.
  const legal = unique(m.legalHits.values());
  if (legal.length > 1) return { kind: 'conflict', reason: 'identifiers-disagree', companyIds: legal };

  // 5. The source's own record id on a row it did not create.
  const record = unique(m.recordHits.values());
  if (record.length > 1) return { kind: 'conflict', reason: 'record-ids-disagree', companyIds: record };
  if (record.length === 1) {
    if (legal.length === 1 && legal[0] !== record[0]) {
      return { kind: 'conflict', reason: 'record-id-vs-identifier', companyIds: unique([...legal, ...record]) };
    }
    // Unconfirmed: the alias may have been attached by a name match, and an
    // inference cannot validate itself.
    return { kind: 'hold', reason: 'unbound-record-alias', companyIds: record };
  }

  if (legal.length === 1) {
    const c = m.candidates.get(legal[0]!);
    if (!c?.live) return { kind: 'create', reason: 'identifier-target-gone' };
    // A legal identifier is a statement by the publisher about which entity
    // this is; a different Companies House number on the row says otherwise.
    if (m.companyNumber && c.companyNumber && c.companyNumber !== m.companyNumber) {
      return { kind: 'conflict', reason: 'company-number-differs', companyIds: [c.id] };
    }
    return { kind: 'existing', companyId: c.id, method: 'identifier' };
  }

  // 6. A domain held by exactly one live company.
  const holders = unique(m.domainHolders).filter((id) => m.candidates.get(id)?.live);
  if (holders.length > 1) return { kind: 'create', reason: 'domain-shared' };
  if (holders.length === 1) {
    const c = m.candidates.get(holders[0]!)!;
    if (holdsOtherRecord(c, m.source, m.sourceCompanyId)) return { kind: 'create', reason: 'distinct-source-record' };
    if (m.companyNumber && c.companyNumber && c.companyNumber !== m.companyNumber) {
      return { kind: 'create', reason: 'company-number-differs' };
    }
    if (c.unresolvedAliases.length > 0) {
      return { kind: 'hold', reason: 'domain-on-unresolved-company', companyIds: [c.id] };
    }
    return { kind: 'existing', companyId: c.id, method: 'domain' };
  }

  // 7. Nothing structural: a separate, source-keyed company.
  return { kind: 'create', reason: 'no-structural-match' };
}

// --- Conservative company identity key ------------------------------------------

/** Legal forms that never carry meaning in a company name. `ag`, `sa`, `co`,
 *  `nv`, `bv`, `as` are deliberately absent: "Indigo Ag" is agriculture, not
 *  Aktiengesellschaft, and stripping it made "Indigo Ag Inc." equal "Indigo". */
const UNAMBIGUOUS_LEGAL_FORMS = new Set([
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'llc',
  'llp',
  'lp',
  'ltd',
  'limited',
  'plc',
  'gmbh',
  'pty',
  'pte',
]);

/**
 * The name key ingest uses to PROPOSE a review candidate — never to combine.
 * Accents folded, lowercase, punctuation to a space, dotted acronyms glued
 * ("L.L.C." → "llc"), and at most ONE trailing unambiguous legal form dropped.
 */
export function companyIdentityKey(name: string): string {
  const raw = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const tokens: string[] = [];
  for (let i = 0; i < raw.length; ) {
    let j = i;
    while (j < raw.length && raw[j]!.length === 1) j++;
    if (j - i >= 2) {
      tokens.push(raw.slice(i, j).join(''));
      i = j;
    } else {
      tokens.push(raw[i]!);
      i += 1;
    }
  }
  if (tokens.length > 1 && UNAMBIGUOUS_LEGAL_FORMS.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(' ');
}

// --- Evidence hashing ---------------------------------------------------------------

/** Deterministic JSON: object keys sorted at every depth, BigInt as a string. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortDeep((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The whitelisted identity evidence a binding stores: no prose, no contacts. */
export interface BindingEvidence {
  name: string;
  domain: string | null;
  countryCode: string | null;
  identifiers: string[];
}

export function bindingEvidence(r: {
  name: string;
  domain?: string | null;
  countryCode?: string | null;
  identifiers?: { scheme: string; value: string }[];
}): { evidence: BindingEvidence; hash: string } {
  const evidence: BindingEvidence = {
    name: r.name,
    domain: r.domain ?? null,
    countryCode: r.countryCode ?? null,
    identifiers: (r.identifiers ?? []).map((i) => `${i.scheme}:${i.value}`).sort(),
  };
  return { evidence, hash: sha256(canonicalJson(evidence)) };
}
