/**
 * Shared shapes for the company-match repair (`company-match-repair` CLI).
 *
 * Everything here is serialised into private operator artifacts (plan.json,
 * groups.jsonl, the CompanyRepairGroup journal). Money travels as decimal
 * strings, never JS numbers; no prose, contact or account data is ever placed
 * in an operation — only ids, safe company names/slugs and source facts.
 */

export const REPAIR_TOOL_VERSION = 'company-match-repair/1';
export const PLAN_FORMAT = 'capbase-company-repair-plan';
export const PLAN_FORMAT_VERSION = 1;

/** The source whose identities this repair partitions. */
export const REPAIR_SOURCE = 'PARTNER';

/** A group's audit outcome. */
export type GroupClass = 'consistent' | 'repairable' | 'review_required' | 'source_missing';

/** JSON-safe scalar or structure (BigInt already stringified). */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** The Company columns a repair may create or set, with their SQL types. The
 *  executor accepts no other column, whatever a manifest says. */
export const COMPANY_COLUMNS: Record<string, string> = {
  slug: 'text',
  name: 'text',
  domain: 'text',
  websiteUrl: 'text',
  linkedinUrl: 'text',
  legalName: 'text',
  operatingStatus: 'text',
  companyType: 'text',
  primarySector: 'text',
  countryCode: 'text',
  oneLiner: 'text',
  description: 'text',
  hq: 'text',
  founded: 'int4',
  headcount: 'int4',
  industry: 'text[]',
  status: 'text',
  stage: 'text',
  totalRaisedUsd: 'int8',
  partnerFields: 'text[]',
  partnerOnly: 'bool',
  externalSource: 'text',
  externalId: 'text',
  moderationStatus: '"ReviewStatus"',
};

/** Columns `setCompanyField` may change on an existing company. */
export const SETTABLE_FIELDS = new Set([
  'totalRaisedUsd',
  'domain',
  'websiteUrl',
  'linkedinUrl',
  'primarySector',
  'legalName',
  'operatingStatus',
  'companyType',
  'countryCode',
  'hq',
  'industry',
  'founded',
  'headcount',
]);

export interface BindingState {
  companyId: string | null;
  status: 'RESOLVED' | 'REVIEW_REQUIRED';
  method: string;
  evidenceHash: string;
  evidence: Json;
}

/** The typed, allowlisted mutations. No SQL, no table or column from JSON
 *  beyond the allowlists above. */
export type Op =
  | { op: 'createCompany'; id: string; data: Record<string, Json> }
  | { op: 'moveRound'; id: string; from: string; to: string }
  | { op: 'moveHolding'; id: string; from: string; to: string }
  | { op: 'moveIdentifier'; id: string; scheme: string; value: string; from: string; to: string }
  | { op: 'moveRevision'; id: string; from: string; to: string }
  | { op: 'setCompanyField'; companyId: string; field: string; before: Json; after: Json }
  | {
      op: 'upsertBinding';
      source: string;
      sourceCompanyId: string;
      before: BindingState | null;
      after: BindingState;
    }
  | {
      op: 'appendRevision';
      id: string;
      companyId: string;
      action: 'REPAIR' | 'UPDATE';
      field: string;
      before: Json;
      after: Json;
      actorSource: string;
    };

/** One group of a plan: everything one transaction applies. */
export interface PlannedGroup {
  key: string;
  /** `repair` partitions a group; `certify`/`hold` are binding batches. */
  kind: 'repair' | 'certify' | 'hold';
  companyIds: string[];
  sourceIds: string[];
  /** Hash of the hydrated evidence the plan was built from; apply refuses a
   *  group whose current evidence hashes differently. */
  observedHash: string;
  /** What hydration probed besides the companies (repair groups): the slugs and
   *  ids it checked for availability, so apply re-reads exactly the same. */
  probe: { slugs: string[]; createIds: string[] };
  ops: Op[];
  /** What a verify should find afterwards (totals as decimal strings). */
  expect: {
    rounds: number;
    holdings: number;
    amountUsd: string;
    totals: Record<string, string>;
    slugs: Record<string, string>;
  };
}

export interface RepairPlan {
  format: typeof PLAN_FORMAT;
  formatVersion: number;
  toolVersion: string;
  policyVersion: number;
  databaseFingerprint: string;
  source: { bundleSha256: string };
  selection: { slug: string | null; limitGroups: number | null; bindings: BindingSelection; limitBindingBatches: number | null };
  groups: PlannedGroup[];
  /** SHA-256 over everything above (canonical JSON). */
  manifestHash: string;
}

export type BindingSelection = 'none' | 'certify' | 'hold' | 'all';

/** One audited group, as written to groups.jsonl / review.jsonl. */
export interface AuditedGroup {
  key: string;
  class: GroupClass;
  reasons: string[];
  companies: { id: string; slug: string; name: string; externalSource: string | null; externalId: string | null }[];
  sourceIds: string[];
  /** The source id whose identity keeps the incumbent company. */
  anchor: string | null;
  /** Source ids that would move to their own company. */
  moves: string[];
  observedHash: string;
  notes: string[];
}
