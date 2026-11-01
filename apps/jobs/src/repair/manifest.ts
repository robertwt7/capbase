/**
 * The repair's private operator artifacts and the immutable plan.
 *
 * `plan.json` holds typed operations (never SQL), the target fingerprint, the
 * bundle hash and a `manifestHash` over all of it — apply recomputes that hash
 * and refuses an edited file. Nothing here carries timestamps, so the same
 * database state and bundle always produce the same operation hashes.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { COMPANY_MATCH_POLICY_VERSION, canonicalJson, sha256 } from '../ingest/company-matcher';
import type { AuditOutput } from './audit';
import {
  COMPANY_COLUMNS,
  PLAN_FORMAT,
  PLAN_FORMAT_VERSION,
  REPAIR_TOOL_VERSION,
  SETTABLE_FIELDS,
  type BindingSelection,
  type Op,
  type PlannedGroup,
  type RepairPlan,
} from './types';

export class ManifestError extends Error {}

export function buildPlan(args: {
  fingerprint: string;
  bundleSha256: string;
  groups: PlannedGroup[];
  selection: RepairPlan['selection'];
}): RepairPlan {
  const body = {
    format: PLAN_FORMAT,
    formatVersion: PLAN_FORMAT_VERSION,
    toolVersion: REPAIR_TOOL_VERSION,
    policyVersion: COMPANY_MATCH_POLICY_VERSION,
    databaseFingerprint: args.fingerprint,
    source: { bundleSha256: args.bundleSha256 },
    selection: args.selection,
    groups: args.groups,
  } as const;
  return { ...body, manifestHash: sha256(canonicalJson(body)) };
}

/** Read and fully validate a plan file: format, versions, hash, and every
 *  operation against the allowlists. Throws before any session is opened. */
export function readPlan(path: string): RepairPlan {
  if (!existsSync(path)) throw new ManifestError(`plan ${path} not found`);
  let plan: RepairPlan;
  try {
    plan = JSON.parse(readFileSync(path, 'utf8')) as RepairPlan;
  } catch {
    throw new ManifestError(`plan ${path} is not valid JSON`);
  }
  if (plan.format !== PLAN_FORMAT || plan.formatVersion !== PLAN_FORMAT_VERSION) {
    throw new ManifestError('not a company-repair plan (format/version mismatch)');
  }
  if (plan.toolVersion !== REPAIR_TOOL_VERSION) {
    throw new ManifestError(`plan was made by ${plan.toolVersion}; this is ${REPAIR_TOOL_VERSION}`);
  }
  if (plan.policyVersion !== COMPANY_MATCH_POLICY_VERSION) {
    throw new ManifestError(`plan policy v${plan.policyVersion}; this tool enforces v${COMPANY_MATCH_POLICY_VERSION}`);
  }
  const { manifestHash, ...body } = plan;
  if (sha256(canonicalJson(body)) !== manifestHash) {
    throw new ManifestError('plan manifestHash does not match its content — the file was edited');
  }
  if (!Array.isArray(plan.groups)) throw new ManifestError('plan has no groups');
  const keys = new Set<string>();
  for (const g of plan.groups) {
    if (keys.has(g.key)) throw new ManifestError(`duplicate group ${g.key}`);
    keys.add(g.key);
    if (!['repair', 'certify', 'hold'].includes(g.kind)) throw new ManifestError(`group ${g.key}: unknown kind`);
    for (const op of g.ops) validateOp(g.key, op);
  }
  return plan;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function validateOp(key: string, op: Op): void {
  const bad = (why: string) => {
    throw new ManifestError(`group ${key}: invalid ${op.op} operation (${why})`);
  };
  switch (op.op) {
    case 'createCompany':
      if (!ID_RE.test(op.id)) bad('id');
      for (const col of Object.keys(op.data)) if (!(col in COMPANY_COLUMNS)) bad(`column ${col}`);
      if (typeof op.data.slug !== 'string' || !op.data.slug) bad('slug');
      return;
    case 'moveRound':
    case 'moveHolding':
    case 'moveRevision':
      if (![op.id, op.from, op.to].every((v) => ID_RE.test(v))) bad('id');
      return;
    case 'moveIdentifier':
      if (![op.id, op.from, op.to].every((v) => ID_RE.test(v))) bad('id');
      if (op.scheme !== 'PARTNER' && op.scheme !== 'DOMAIN') bad('scheme');
      return;
    case 'setCompanyField':
      if (!ID_RE.test(op.companyId)) bad('id');
      if (!SETTABLE_FIELDS.has(op.field)) bad(`field ${op.field}`);
      return;
    case 'upsertBinding':
      if (op.source !== 'PARTNER' || !op.sourceCompanyId) bad('source');
      if (op.after.status !== 'RESOLVED' && op.after.status !== 'REVIEW_REQUIRED') bad('status');
      return;
    case 'appendRevision':
      if (!ID_RE.test(op.id) || !ID_RE.test(op.companyId)) bad('id');
      if (op.action !== 'REPAIR' && op.action !== 'UPDATE') bad('action');
      if (op.action === 'UPDATE' && !SETTABLE_FIELDS.has(op.field)) bad('field');
      return;
    default:
      bad('unknown operation');
  }
}

/** Private output directory: created 0700, files 0600. */
export function privateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

export function writePrivate(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

const jsonl = (rows: unknown[]) => rows.map((r) => canonicalJson(r)).join('\n') + (rows.length ? '\n' : '');

/** summary.json, coverage.json, groups.jsonl, review.jsonl. */
export function writeAuditArtifacts(dir: string, audit: AuditOutput, meta: Record<string, unknown>): void {
  privateDir(dir);
  const review = audit.groups.filter((g) => g.class === 'review_required' || g.class === 'source_missing');
  const summary = {
    ...meta,
    note:
      'Suspicion counts (several source ids on one company) are not error counts. "repairable" groups have source-proved ' +
      'ownership and a complete plan; "review_required" and "source_missing" are left for a person.',
    classes: audit.counts,
    reasons: Object.fromEntries(Object.entries(audit.reasons).sort(([a], [b]) => a.localeCompare(b))),
    multiSourceCompanies: audit.groups.filter((g) => g.sourceIds.length > 1).length,
    repairGroups: audit.repairs.length,
    repairMoves: audit.repairs.reduce(
      (n, g) => n + g.ops.filter((o) => o.op === 'moveRound' || o.op === 'moveHolding').length,
      0,
    ),
    newCompanies: audit.repairs.reduce((n, g) => n + g.ops.filter((o) => o.op === 'createCompany').length, 0),
    bindingCertifications: audit.certify.length,
    bindingHolds: audit.holds.length,
  };
  writePrivate(dir, 'summary.json', JSON.stringify(summary, null, 2) + '\n');
  writePrivate(dir, 'coverage.json', JSON.stringify(audit.coverage, null, 2) + '\n');
  writePrivate(dir, 'groups.jsonl', jsonl(audit.groups));
  writePrivate(dir, 'review.jsonl', jsonl(review));
}

export function selectionOf(args: {
  slug?: string | null;
  limitGroups?: number | null;
  bindings?: BindingSelection;
  limitBindingBatches?: number | null;
}): RepairPlan['selection'] {
  return {
    slug: args.slug ?? null,
    limitGroups: args.limitGroups ?? null,
    bindings: args.bindings ?? 'none',
    limitBindingBatches: args.limitBindingBatches ?? null,
  };
}
