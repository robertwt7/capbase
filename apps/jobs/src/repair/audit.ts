/**
 * The company-match audit: every partner company association, grouped into
 * connected identity groups and classified, plus the exact operations a repair
 * would apply to each clear case.
 *
 * READ-ONLY by construction: it is handed a `Q` on a server-enforced read-only
 * session (db.ts) and issues SELECTs only — no temp tables, no progress rows.
 *
 * Coverage is the union of every way a source company id can be associated
 * with a Capbase company: the row it created (provenance key), its PARTNER
 * identifier, the source's own rounds (deal → original company, from the
 * bundle), its holdings (`${company_id}:${firm_id}`), and any binding. A group
 * is one connected component of that graph, so a child sitting on the "wrong"
 * company joins the two even when no identifier says so.
 */
import { companyIdentityKey, countriesCompatible, COMPANY_MATCH_POLICY_VERSION, bindingEvidence, canonicalJson, sha256 } from '../ingest/company-matcher';
import { suppliedCompanyFields } from '../ingest/company-fields';
import {
  PARTNER_SECTOR_MAP,
  cleanProse,
  companyFacts,
  companyStage,
  dealEligible,
  oneLinerOf,
  partnerCountry,
  roundFor,
  websiteUrl,
  type CompanyRow,
  type DealRow,
} from '../sources/partner/partner.parser';
import { identifyingDomain } from '../util/domain';
import { kebab } from '../util/slug';
import { pages, repairTablesPresent, type Q } from './db';
import { evidenceHash, hydrate, type CompanyEv, type Evidence } from './hydrate';
import type { SourceSnapshot } from './source-snapshot';
import {
  REPAIR_SOURCE,
  type AuditedGroup,
  type BindingSelection,
  type BindingState,
  type GroupClass,
  type Json,
  type Op,
  type PlannedGroup,
} from './types';

/** A repair larger than this stays review-only: one bounded transaction each. */
export const MAX_GROUP_ROWS = 2_000;
/** Bindings per certify/hold batch (one transaction each). */
export const BINDING_BATCH = 500;
/** Groups hydrated per read-only transaction. */
const HYDRATE_BATCH = 100;

const RESTORABLE_FIELDS = [
  'domain',
  'websiteUrl',
  'linkedinUrl',
  'primarySector',
  'legalName',
  'operatingStatus',
  'countryCode',
  'hq',
  'industry',
] as const;

export interface AuditOptions {
  /** Plan only the group containing this company slug. */
  slug?: string | null;
  /** Target fingerprint, for deterministic created ids (plan mode). */
  fingerprint: string;
  log: (msg: string) => void;
}

export interface AuditCoverage {
  identifiers: number;
  partnerCreatedCompanies: number;
  partnerRounds: number;
  partnerHoldings: number;
  bindings: number;
  /** Rounds whose deal the bundle does not contain. */
  roundsSourceMissing: number;
  /** Holdings whose source company the bundle does not contain (or whose key is malformed). */
  holdingsSourceMissing: number;
  /** Identifiers whose source company the bundle does not contain. */
  identifiersSourceMissing: number;
  groups: number;
  trivialAnchors: number;
  bindingTablesPresent: boolean;
}

export interface AuditOutput {
  coverage: AuditCoverage;
  groups: AuditedGroup[];
  /** Repair groups, in key order. */
  repairs: PlannedGroup[];
  /** Binding certifications for consistent associations, unbatched. */
  certify: BindingCandidate[];
  /** Private holds for unresolved aliases, unbatched. */
  holds: BindingCandidate[];
  counts: Record<GroupClass, number>;
  reasons: Record<string, number>;
}

export interface BindingCandidate {
  sourceId: string;
  companyId: string;
  status: 'RESOLVED' | 'REVIEW_REQUIRED';
  method: string;
  evidence: Json;
  evidenceHash: string;
  before: BindingState | null;
}

// --- Union-find over "c:<companyId>" and "s:<sourceId>" ----------------------------

class Groups {
  private parent = new Map<string, string>();
  find(x: string): string {
    let root = x;
    for (;;) {
      const p = this.parent.get(root);
      if (p === undefined) {
        this.parent.set(root, root);
        break;
      }
      if (p === root) break;
      root = p;
    }
    // Path compression.
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  nodes(): IterableIterator<string> {
    return this.parent.keys();
  }
}

interface CompanyInfo {
  externalSource: string | null;
  externalId: string | null;
  mergedIntoId: string | null;
}

/** Facts about one source id derived from the bundle exactly as ingest would. */
interface SourceIdentity {
  sid: string;
  name: string;
  site: string | null;
  domain: string | null;
  countryCode: string | null;
  status: string | null;
}

function identityOf(row: CompanyRow): SourceIdentity {
  const site = websiteUrl(row.website);
  return {
    sid: row.company_id,
    name: row.name.trim(),
    site,
    domain: identifyingDomain(site),
    countryCode: partnerCountry(row.country),
    status: row.status,
  };
}

export async function runAudit(q: Q, snap: SourceSnapshot, opts: AuditOptions): Promise<AuditOutput> {
  const tables = await repairTablesPresent(q);
  const g = new Groups();
  const info = new Map<string, CompanyInfo>();
  /** sid → the company holding its PARTNER identifier. */
  const identifierOf = new Map<string, string>();
  /** Nodes with something the trivial check must not wave through. */
  const flagged = new Set<string>();
  const coverage: AuditCoverage = {
    identifiers: 0,
    partnerCreatedCompanies: 0,
    partnerRounds: 0,
    partnerHoldings: 0,
    bindings: 0,
    roundsSourceMissing: 0,
    holdingsSourceMissing: 0,
    identifiersSourceMissing: 0,
    groups: 0,
    trivialAnchors: 0,
    bindingTablesPresent: tables.bindings,
  };
  const existingBindings = new Map<string, BindingState>();

  // One consistent snapshot for the whole mapping read.
  await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    opts.log('mapping: partner identifiers');
    for await (const rows of pages<{ id: string; entityId: string; value: string }>(
      q,
      (n) => `SELECT id, "entityId", value FROM "EntityIdentifier"
               WHERE "entityType" = 'company' AND scheme = 'PARTNER' AND id > $1 ORDER BY id LIMIT ${n}`,
      (r) => r.id,
    )) {
      for (const r of rows) {
        coverage.identifiers++;
        identifierOf.set(r.value, r.entityId);
        g.union(`c:${r.entityId}`, `s:${r.value}`);
        if (!snap.companyIds.has(r.value)) {
          coverage.identifiersSourceMissing++;
          flagged.add(`s:${r.value}`);
        }
      }
    }
    opts.log('mapping: companies');
    for await (const rows of pages<{ id: string; externalSource: string | null; externalId: string | null; mergedIntoId: string | null }>(
      q,
      (n) => `SELECT c.id, c."externalSource", c."externalId", c."mergedIntoId" FROM "Company" c
               WHERE c.id > $1 AND (c."externalSource" = 'PARTNER' OR EXISTS (
                 SELECT 1 FROM "EntityIdentifier" e WHERE e."entityType" = 'company' AND e."entityId" = c.id AND e.scheme = 'PARTNER'))
               ORDER BY c.id LIMIT ${n}`,
      (r) => r.id,
    )) {
      for (const c of rows) {
        info.set(c.id, { externalSource: c.externalSource, externalId: c.externalId, mergedIntoId: c.mergedIntoId });
        if (c.externalSource === REPAIR_SOURCE && c.externalId) {
          coverage.partnerCreatedCompanies++;
          g.union(`c:${c.id}`, `s:${c.externalId}`);
        }
        if (c.mergedIntoId) {
          g.union(`c:${c.id}`, `c:${c.mergedIntoId}`);
          flagged.add(`c:${c.id}`);
        }
      }
    }
    opts.log('mapping: partner rounds');
    for await (const rows of pages<{ id: string; externalId: string; companyId: string }>(
      q,
      (n) => `SELECT id, "externalId", "companyId" FROM "FundingRound"
               WHERE "externalSource" = 'PARTNER' AND id > $1 ORDER BY id LIMIT ${n}`,
      (r) => r.id,
    )) {
      for (const r of rows) {
        coverage.partnerRounds++;
        const sid = snap.dealCompany.get(r.externalId);
        if (!sid) {
          coverage.roundsSourceMissing++;
          flagged.add(`c:${r.companyId}`);
          g.find(`c:${r.companyId}`);
          continue;
        }
        g.union(`c:${r.companyId}`, `s:${sid}`);
      }
    }
    opts.log('mapping: partner holdings');
    for await (const rows of pages<{ id: string; externalId: string; companyId: string }>(
      q,
      (n) => `SELECT id, "externalId", "companyId" FROM "InvestorHolding"
               WHERE "externalSource" = 'PARTNER' AND id > $1 ORDER BY id LIMIT ${n}`,
      (r) => r.id,
    )) {
      for (const h of rows) {
        coverage.partnerHoldings++;
        const sid = holdingSource(h.externalId);
        if (!sid || !snap.companyIds.has(sid)) {
          coverage.holdingsSourceMissing++;
          flagged.add(`c:${h.companyId}`);
          g.find(`c:${h.companyId}`);
          continue;
        }
        g.union(`c:${h.companyId}`, `s:${sid}`);
      }
    }
    if (tables.bindings) {
      opts.log('mapping: bindings');
      const { rows } = await q.query<{ sourceCompanyId: string; companyId: string | null; status: string; method: string; evidenceHash: string; evidence: Json }>(
        `SELECT "sourceCompanyId", "companyId", status, method, "evidenceHash", evidence FROM "CompanyIngestBinding" WHERE source = 'PARTNER'`,
      );
      for (const b of rows) {
        coverage.bindings++;
        existingBindings.set(b.sourceCompanyId, {
          companyId: b.companyId,
          status: b.status === 'RESOLVED' ? 'RESOLVED' : 'REVIEW_REQUIRED',
          method: b.method,
          evidenceHash: b.evidenceHash,
          evidence: b.evidence,
        });
        if (b.companyId) g.union(`c:${b.companyId}`, `s:${b.sourceCompanyId}`);
        else g.find(`s:${b.sourceCompanyId}`);
        // A hold on an otherwise clean anchor is worth showing the operator.
        if (b.status !== 'RESOLVED') flagged.add(`s:${b.sourceCompanyId}`);
      }
    }
  } finally {
    await q.query('COMMIT');
  }

  // --- Components -----------------------------------------------------------------
  const size = new Map<string, { c: number; s: number }>();
  for (const node of g.nodes()) {
    const root = g.find(node);
    const e = size.get(root) ?? { c: 0, s: 0 };
    if (node.startsWith('c:')) e.c++;
    else e.s++;
    size.set(root, e);
  }
  coverage.groups = size.size;
  const members = new Map<string, { companies: string[]; sids: string[] }>();
  for (const node of g.nodes()) {
    const root = g.find(node);
    let m = members.get(root);
    if (!m) members.set(root, (m = { companies: [], sids: [] }));
    if (node.startsWith('c:')) m.companies.push(node.slice(2));
    else m.sids.push(node.slice(2));
  }
  const candidates: { companies: string[]; sids: string[] }[] = [];
  for (const [root, m] of members) {
    if (m.companies.length === 1 && m.sids.length === 1) {
      const cid = m.companies[0]!;
      const sid = m.sids[0]!;
      const c = info.get(cid);
      const clean =
        c?.externalSource === REPAIR_SOURCE &&
        c.externalId === sid &&
        !c.mergedIntoId &&
        snap.companyIds.has(sid) &&
        !flagged.has(`c:${cid}`) &&
        !flagged.has(`s:${sid}`);
      if (clean) {
        coverage.trivialAnchors++;
        members.delete(root);
        continue;
      }
    }
    m.companies.sort();
    m.sids.sort();
    candidates.push(m);
  }
  candidates.sort((a, b) => groupKey(a).localeCompare(groupKey(b)));
  opts.log(`groups: ${coverage.groups} (${coverage.trivialAnchors} clean partner-created anchors, ${candidates.length} to examine)`);

  // A SLUG plan examines only the group containing that company.
  let selected = candidates;
  if (opts.slug) {
    const { rows } = await q.query<{ id: string }>(`SELECT id FROM "Company" WHERE slug = $1`, [opts.slug]);
    const id = rows[0]?.id;
    if (!id) throw new Error(`no company with slug ${opts.slug}`);
    selected = candidates.filter((m) => m.companies.includes(id));
    if (selected.length === 0) throw new Error(`${opts.slug} is in no group that needs examining`);
  }

  // --- Source facts for the groups examined ---------------------------------------
  const sidsNeeded = new Set(selected.flatMap((m) => m.sids));
  opts.log(`bundle: reading facts for ${sidsNeeded.size} source companies`);
  const facts = await snap.companies(sidsNeeded);
  const deals = await snap.deals(sidsNeeded);

  // --- Hydrate + classify -----------------------------------------------------------
  const out: AuditOutput = {
    coverage,
    groups: [],
    repairs: [],
    certify: [],
    holds: [],
    counts: { consistent: 0, repairable: 0, review_required: 0, source_missing: 0 },
    reasons: {},
  };
  for (let i = 0; i < selected.length; i += HYDRATE_BATCH) {
    const batch = selected.slice(i, i + HYDRATE_BATCH);
    await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      for (const m of batch) {
        const ctx: GroupContext = {
          companyIds: m.companies,
          sourceIds: m.sids,
          facts,
          deals,
          dealCompany: snap.dealCompany,
          existingBindings,
          fingerprint: opts.fingerprint,
          bindingsTable: tables.bindings,
        };
        const result = await examineGroup(q, ctx);
        out.groups.push(result.audited);
        out.counts[result.audited.class]++;
        for (const r of result.audited.reasons) out.reasons[r] = (out.reasons[r] ?? 0) + 1;
        if (result.repair) out.repairs.push(result.repair);
        out.certify.push(...result.certify);
        out.holds.push(...result.holds);
      }
    } finally {
      await q.query('COMMIT');
    }
    if ((i / HYDRATE_BATCH) % 20 === 0) opts.log(`examined ${Math.min(i + HYDRATE_BATCH, selected.length)}/${selected.length} groups`);
  }
  return out;
}

export function groupKey(m: { sids: string[]; companies: string[] }): string {
  return m.sids.length ? `src:${m.sids.join('+')}` : `co:${m.companies.join('+')}`;
}

/** `${company_id}:${firm_id}` → company_id; null when malformed. */
export function holdingSource(externalId: string | null): string | null {
  if (!externalId) return null;
  const i = externalId.indexOf(':');
  return i > 0 && i < externalId.length - 1 ? externalId.slice(0, i) : null;
}

export interface GroupContext {
  companyIds: string[];
  sourceIds: string[];
  facts: Map<string, CompanyRow>;
  deals: Map<string, DealRow[]>;
  dealCompany: Map<string, string>;
  existingBindings: Map<string, BindingState>;
  fingerprint: string;
  bindingsTable: boolean;
}

export interface GroupResult {
  audited: AuditedGroup;
  repair: PlannedGroup | null;
  certify: BindingCandidate[];
  holds: BindingCandidate[];
}

/** Deterministic id for a row the repair creates (so a replay cannot mint a twin). */
export function repairId(kind: string, fingerprint: string, ...parts: string[]): string {
  return `cr${kind}${sha256(`${fingerprint}|${kind}|${parts.join('|')}`).slice(0, 21)}`;
}

function slugCandidates(name: string, sid: string): string[] {
  const base = `${kebab(name)}-${kebab(sid)}`;
  return [base, `${base}-2`, `${base}-3`, `${base}-4`];
}

/** Hydrate one group, classify it, and plan what a repair would do. */
export async function examineGroup(q: Q, ctx: GroupContext): Promise<GroupResult> {
  const key = groupKey({ sids: ctx.sourceIds, companies: ctx.companyIds });
  const slugs = ctx.sourceIds.flatMap((sid) => slugCandidates(ctx.facts.get(sid)?.name ?? sid, sid));
  const createIds = ctx.sourceIds.map((sid) => repairId('c', ctx.fingerprint, sid));
  const ev = await hydrate(q, ctx.companyIds, {
    sourceIds: ctx.sourceIds,
    slugs,
    createIds,
    bindingsTable: ctx.bindingsTable,
  });
  const observedHash = evidenceHash(ev);
  const result = classify(key, ev, observedHash, ctx);
  if (result.repair) result.repair.probe = { slugs: [...new Set(slugs)].sort(), createIds: [...new Set(createIds)].sort() };
  return result;
}

/** The hydration options a plan group was observed with. */
export function probeOptions(g: PlannedGroup, bindingsTable = true) {
  return { sourceIds: g.sourceIds, slugs: g.probe.slugs, createIds: g.probe.createIds, bindingsTable };
}

/** Pure: classify a hydrated group and plan its operations. Exported for tests. */
export function classify(key: string, ev: Evidence, observedHash: string, ctx: GroupContext): GroupResult {
  const reasons: string[] = [];
  const notes: string[] = [];
  const reason = (r: string) => {
    if (!reasons.includes(r)) reasons.push(r);
  };
  const companies = ev.companies;
  const audited = (cls: GroupClass, anchor: string | null, moves: string[]): AuditedGroup => ({
    key,
    class: cls,
    reasons,
    companies: companies.map((c) => ({ id: c.id, slug: c.slug, name: c.name, externalSource: c.externalSource, externalId: c.externalId })),
    sourceIds: ctx.sourceIds,
    anchor,
    moves,
    observedHash,
    notes,
  });
  const none = { repair: null, certify: [] as BindingCandidate[], holds: [] as BindingCandidate[] };

  // --- Missing source data: never infer anything from an absence. ---------------
  const partnerRounds = ev.rounds.filter((r) => r.externalSource === REPAIR_SOURCE);
  const partnerHoldings = ev.holdings.filter((h) => h.externalSource === REPAIR_SOURCE);
  if (ctx.sourceIds.some((s) => !ctx.facts.has(s))) reason('source_company_missing');
  if (partnerRounds.some((r) => !r.externalId || !ctx.dealCompany.has(r.externalId))) reason('source_deal_missing');
  if (partnerHoldings.some((h) => !holdingSource(h.externalId) || !ctx.facts.has(holdingSource(h.externalId)!))) {
    reason('source_holding_missing');
  }
  if (reasons.length) return { audited: audited('source_missing', null, []), ...none, holds: holdsFor(ctx, ev, reasons) };

  if (companies.length !== 1) {
    reason(ev.merges.some((m) => !m.unmerged) || companies.some((c) => c.mergedIntoId) ? 'reviewed_merge' : 'children_split_across_companies');
    return { audited: audited('review_required', null, []), ...none, holds: holdsFor(ctx, ev, reasons) };
  }

  const x = companies[0]!;
  if (x.mergedIntoId) reason('tombstone_holds_associations');
  if (x.moderationStatus !== 'APPROVED') reason('incumbent_not_approved');
  if (ev.merges.some((m) => !m.unmerged)) reason('reviewed_merge');
  const binding = (s: string) => ctx.existingBindings.get(s) ?? null;
  for (const s of ctx.sourceIds) {
    const b = binding(s);
    // A private hold is a marker, not an adjudication: the evidence still
    // decides, and a repair replaces the hold through its own binding op.
    if (b && b.status !== 'RESOLVED') notes.push(`held: ${b.method}`);
    if (b?.status === 'RESOLVED' && b.companyId !== x.id) reason('binding_points_elsewhere');
  }
  if (reasons.length) return { audited: audited('review_required', null, []), ...none, holds: holdsFor(ctx, ev, reasons) };

  const ids = new Map(ctx.sourceIds.map((s) => [s, identityOf(ctx.facts.get(s)!)]));
  const partnerCreated = x.externalSource === REPAIR_SOURCE;
  // The incumbent's own domain, when a source other than the partner stated it.
  const independentDomain = !partnerCreated && x.domain && !x.partnerFields.includes('domain') ? x.domain : null;

  // --- The anchor: the identity the incumbent company keeps. ---------------------
  let anchor: string | null = null;
  if (partnerCreated) anchor = x.externalId;
  else if (independentDomain) {
    const hits = ctx.sourceIds.filter((s) => ids.get(s)!.domain === independentDomain);
    if (hits.length === 1) anchor = hits[0]!;
  }

  // --- One source id: certify or report. ------------------------------------------
  if (ctx.sourceIds.length === 1) {
    const sid = ctx.sourceIds[0]!;
    const id = ids.get(sid)!;
    if (partnerCreated) {
      // An anchored partner row that only failed the trivial check on a flag.
      return { audited: audited('consistent', sid, []), ...none };
    }
    let evidenceKind: string | null = null;
    if (anchor === sid) evidenceKind = 'domain';
    else if (independentDomain && id.domain && id.domain !== independentDomain) reason('singleton_domain_mismatch');
    else if (
      companyIdentityKey(x.name) === companyIdentityKey(id.name) &&
      !!x.countryCode &&
      !!id.countryCode &&
      countriesCompatible(x.countryCode, id.countryCode)
    ) {
      evidenceKind = 'exact_name_and_country';
    } else reason('singleton_unverified');
    if (!evidenceKind) return { audited: audited('review_required', null, []), ...none, holds: holdsFor(ctx, ev, reasons) };
    notes.push(`certified on ${evidenceKind}`);
    const b = binding(sid);
    const certify =
      b?.status === 'RESOLVED' && b.companyId === x.id ? [] : [bindingCandidate(sid, x.id, 'RESOLVED', `certified:${evidenceKind}`, id, b)];
    return { audited: audited('consistent', sid, []), repair: null, certify, holds: [] };
  }

  // --- Several source ids on one company. -----------------------------------------
  if (!anchor) {
    reason(partnerCreated ? 'anchor_unknown' : 'mixed_no_anchor');
    return { audited: audited('review_required', null, []), ...none, holds: holdsFor(ctx, ev, reasons) };
  }
  const moves = ctx.sourceIds.filter((s) => s !== anchor);
  const anchorDomain = ids.get(anchor)!.domain;
  const seen = new Set<string>([anchorDomain, independentDomain].filter((d): d is string => !!d));
  for (const s of moves) {
    const d = ids.get(s)!.domain;
    if (!d) reason('alias_without_domain');
    else if (d === anchorDomain || d === independentDomain) reason('same_domain_aliases');
    else if (seen.has(d)) reason('aliases_share_domain');
    if (d) seen.add(d);
  }

  // Everything else on the incumbent must have a safe disposition.
  const movedDomains = new Set(moves.map((s) => ids.get(s)!.domain).filter((d): d is string => !!d));
  const isHuman = (src: string | null) => src === null;
  const otherSource = (src: string | null) => src !== null && src !== REPAIR_SOURCE && src !== x.externalSource;
  if ([...ev.rounds, ...ev.holdings, ...ev.otherChildren].some((r) => isHuman(r.externalSource))) reason('human_children');
  if ([...ev.rounds, ...ev.holdings, ...ev.otherChildren].some((r) => otherSource(r.externalSource))) {
    reason('public_children_unresolved');
  }
  if (ev.proposals.some((p) => p.status === 'APPROVED')) reason('human_edits');
  if (ev.revisions.some((r) => r.entityType === 'company' && r.entityId === x.id && r.actor !== 'INGEST')) reason('human_edits');
  for (const i of ev.identifiers) {
    if (i.scheme === 'DOMAIN' && movedDomains.has(i.value) && i.entityId === x.id && i.source !== REPAIR_SOURCE) {
      reason('moved_domain_stated_by_other_source');
    }
  }
  if (ev.scans.some((s) => movedDomains.has(s.targetDomain)) || ev.apps.some((a) => [...movedDomains].some((d) => a.targetUrl.includes(d)))) {
    reason('website_evidence_for_moved_identity');
  }
  if (x.domain && x.domain !== anchorDomain && movedDomains.has(x.domain) && !restorable(ev, x, 'domain')) {
    reason('incumbent_domain_is_moved_identity');
  }

  // Every eligible deal of a moving identity must have its own round to move.
  const roundsBySid = new Map<string, typeof partnerRounds>();
  for (const r of partnerRounds) {
    const sid = ctx.dealCompany.get(r.externalId!)!;
    const list = roundsBySid.get(sid) ?? [];
    list.push(r);
    roundsBySid.set(sid, list);
  }
  for (const s of moves) {
    const own = new Set((roundsBySid.get(s) ?? []).map((r) => r.externalId));
    for (const d of ctx.deals.get(s) ?? []) {
      if (dealEligible(d) && !own.has(d.deal_id)) reason('unaccounted_deal');
    }
  }
  const holdingsBySid = new Map<string, typeof partnerHoldings>();
  for (const h of partnerHoldings) {
    const sid = holdingSource(h.externalId)!;
    const list = holdingsBySid.get(sid) ?? [];
    list.push(h);
    holdingsBySid.set(sid, list);
  }
  const movedRows = moves.reduce((n, s) => n + (roundsBySid.get(s)?.length ?? 0) + (holdingsBySid.get(s)?.length ?? 0), 0);
  if (movedRows > MAX_GROUP_ROWS) reason('oversized');

  // The incumbent's total: only a proved, source-derived correction.
  const nonGrant = (r: (typeof partnerRounds)[number]) => r.moderationStatus === 'APPROVED' && r.kind !== 'Grant';
  const movedIds = new Set(moves.flatMap((s) => (roundsBySid.get(s) ?? []).map((r) => r.id)));
  const remainingSum = ev.rounds.filter((r) => !movedIds.has(r.id) && nonGrant(r)).reduce((a, r) => a + BigInt(r.amountUsd), 0n);
  const movedSum = ev.rounds.filter((r) => movedIds.has(r.id) && nonGrant(r)).reduce((a, r) => a + BigInt(r.amountUsd), 0n);
  const current = BigInt(x.totalRaisedUsd);
  const totalRevs = ev.revisions
    .filter((r) => r.entityType === 'company' && r.entityId === x.id && r.field === 'totalRaisedUsd')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  // What the split implies: the moved itemised raises leave, never below what remains.
  const implied = (() => {
    const floor = current - movedSum;
    const t = remainingSum > floor ? remainingSum : floor;
    return t > current ? current : t;
  })();
  let newTotal: bigint = current;
  if (implied !== current) {
    // A change is needed: it must be proved source-derived, or left for review.
    if (partnerCreated) {
      if (!x.partnerFields.includes('totalRaisedUsd') || totalRevs.some((r) => r.actorSource !== REPAIR_SOURCE)) {
        reason('uncertain_total');
      } else newTotal = implied;
    } else if (x.partnerFields.includes('totalRaisedUsd')) {
      // The last value another source wrote is the floor; it may cover rounds nobody itemised.
      let i = totalRevs.length - 1;
      while (i >= 0 && totalRevs[i]!.actorSource === REPAIR_SOURCE) i--;
      const firstPartner = totalRevs[i + 1];
      if (!firstPartner || i + 1 >= totalRevs.length) reason('uncertain_total');
      else {
        const floor = BigInt(Math.round(Number(firstPartner.before ?? 0)));
        newTotal = remainingSum > floor ? remainingSum : floor;
      }
    }
    // Not partner-marked on a mixed row: another source wrote it last — kept.
  }
  if (newTotal > current) newTotal = current; // a split never raises the incumbent

  if (reasons.length) {
    return { audited: audited('review_required', anchor, moves), ...none, holds: holdsFor(ctx, ev, reasons) };
  }

  // --- Repairable: plan the operations. -------------------------------------------
  const ops: Op[] = [];
  const expectTotals: Record<string, string> = {};
  const expectSlugs: Record<string, string> = {};
  const taken = new Set(ev.slugsTaken.filter((s) => s.taken).map((s) => s.slug));
  const idTaken = new Set(ev.idsTaken.filter((s) => s.taken).map((s) => s.id));
  let summaryRounds = 0;
  let summaryHoldings = 0;
  const destinations: { sid: string; id: string; slug: string; name: string; rounds: number; holdings: number }[] = [];

  for (const s of moves) {
    const row = ctx.facts.get(s)!;
    const id = repairId('c', ctx.fingerprint, s);
    if (idTaken.has(id)) {
      reason('destination_exists');
      return { audited: audited('review_required', anchor, moves), ...none };
    }
    const slug = slugCandidates(row.name.trim(), s).find((c) => !taken.has(c));
    if (!slug) {
      reason('slug_unavailable');
      return { audited: audited('review_required', anchor, moves), ...none };
    }
    taken.add(slug);
    const rounds = roundsBySid.get(s) ?? [];
    const holdings = holdingsBySid.get(s) ?? [];
    const sum = rounds.filter(nonGrant).reduce((a, r) => a + BigInt(r.amountUsd), 0n);
    const data = destinationData(row, ctx.deals.get(s) ?? [], slug, sum);
    ops.push({ op: 'createCompany', id, data });
    for (const r of rounds) ops.push({ op: 'moveRound', id: r.id, from: x.id, to: id });
    for (const h of holdings) ops.push({ op: 'moveHolding', id: h.id, from: x.id, to: id });
    const childIds = new Set([...rounds.map((r) => r.id), ...holdings.map((h) => h.id)]);
    for (const rev of ev.revisions) {
      if (rev.companyId === x.id && rev.entityType !== 'company' && childIds.has(rev.entityId)) {
        ops.push({ op: 'moveRevision', id: rev.id, from: x.id, to: id });
      }
    }
    const domain = ids.get(s)!.domain;
    for (const i of ev.identifiers) {
      if (i.entityId !== x.id) continue;
      if ((i.scheme === 'PARTNER' && i.value === s) || (i.scheme === 'DOMAIN' && domain && i.value === domain && i.source === REPAIR_SOURCE)) {
        ops.push({ op: 'moveIdentifier', id: i.id, scheme: i.scheme, value: i.value, from: x.id, to: id });
      }
    }
    const ident = identityOf(row);
    ops.push({
      op: 'upsertBinding',
      source: REPAIR_SOURCE,
      sourceCompanyId: s,
      before: ctx.existingBindings.get(s) ?? null,
      after: bindingState(id, 'RESOLVED', 'repair-split', ident),
    });
    expectTotals[id] = sum.toString();
    expectSlugs[id] = slug;
    summaryRounds += rounds.length;
    summaryHoldings += holdings.length;
    destinations.push({ sid: s, id, slug, name: String(data.name), rounds: rounds.length, holdings: holdings.length });
  }

  // Field restores on the incumbent, each proved by its latest revision.
  for (const field of RESTORABLE_FIELDS) {
    const proof = restorable(ev, x, field);
    if (!proof) continue;
    const value: Json = (x as unknown as Record<string, Json>)[field] ?? null;
    const fromMoved = moves.some((s) => sameJson(sourceValue(ctx.facts.get(s)!, field), value));
    const fromAnchor = sameJson(sourceValue(ctx.facts.get(anchor)!, field), value);
    if (!fromMoved || fromAnchor) continue;
    ops.push({ op: 'setCompanyField', companyId: x.id, field, before: value, after: proof.before });
    ops.push(revisionOp(ctx, x.id, 'UPDATE', field, value, proof.before, `${observedHash}:${key}`));
  }
  if (newTotal !== current) {
    ops.push({ op: 'setCompanyField', companyId: x.id, field: 'totalRaisedUsd', before: current.toString(), after: newTotal.toString() });
    ops.push(revisionOp(ctx, x.id, 'UPDATE', 'totalRaisedUsd', Number(current), Number(newTotal), `${observedHash}:${key}`));
  }
  expectTotals[x.id] = newTotal.toString();
  expectSlugs[x.id] = x.slug;
  const anchorBinding = ctx.existingBindings.get(anchor) ?? null;
  if (!(anchorBinding?.status === 'RESOLVED' && anchorBinding.companyId === x.id)) {
    ops.push({
      op: 'upsertBinding',
      source: REPAIR_SOURCE,
      sourceCompanyId: anchor,
      before: anchorBinding,
      after: bindingState(x.id, 'RESOLVED', 'repair-anchor', identityOf(ctx.facts.get(anchor)!)),
    });
  }
  // The displayed explanation: names, slugs and counts only.
  for (const d of destinations) {
    ops.push(
      revisionOp(ctx, x.id, 'REPAIR', '', null, { kind: 'split-out', other: { name: d.name, slug: d.slug }, rounds: d.rounds, holdings: d.holdings }, `${observedHash}:${key}:${d.sid}:out`),
    );
    ops.push(
      revisionOp(ctx, d.id, 'REPAIR', '', null, { kind: 'split-from', other: { name: x.name, slug: x.slug }, rounds: d.rounds, holdings: d.holdings }, `${observedHash}:${key}:${d.sid}:from`),
    );
  }

  const repair: PlannedGroup = {
    key,
    kind: 'repair',
    companyIds: [x.id],
    sourceIds: ctx.sourceIds,
    observedHash,
    probe: { slugs: [], createIds: [] },
    ops,
    expect: {
      rounds: ev.rounds.length,
      holdings: ev.holdings.length,
      amountUsd: ev.rounds.reduce((a, r) => a + BigInt(r.amountUsd), 0n).toString(),
      totals: expectTotals,
      slugs: expectSlugs,
    },
  };
  notes.push(`moves ${summaryRounds} rounds and ${summaryHoldings} holdings to ${destinations.length} new companies`);
  return { audited: audited('repairable', anchor, moves), repair, certify: [], holds: [] };
}

/** Private holds for the alias source ids of a group left for review: their
 *  next ingest must not write through an association nobody has confirmed. */
function holdsFor(ctx: GroupContext, ev: Evidence, reasons: string[]): BindingCandidate[] {
  const out: BindingCandidate[] = [];
  for (const sid of ctx.sourceIds) {
    const own = ev.companies.find((c) => c.externalSource === REPAIR_SOURCE && c.externalId === sid);
    if (own) continue; // its own provenance key routes it; nothing to hold
    const holder = ev.identifiers.find((i) => i.scheme === 'PARTNER' && i.value === sid)?.entityId;
    if (!holder) continue;
    const b = ctx.existingBindings.get(sid) ?? null;
    const method = `hold:${reasons[0] ?? 'review'}`;
    if (b && b.status === 'REVIEW_REQUIRED' && b.companyId === holder) continue;
    if (b?.status === 'RESOLVED') continue; // an explicit decision already exists; leave it to review
    const row = ctx.facts.get(sid);
    out.push(bindingCandidate(sid, holder, 'REVIEW_REQUIRED', method, row ? identityOf(row) : { sid, name: '', site: null, domain: null, countryCode: null, status: null }, b));
  }
  return out;
}

function bindingState(companyId: string | null, status: 'RESOLVED' | 'REVIEW_REQUIRED', method: string, id: SourceIdentity): BindingState {
  const { evidence, hash } = bindingEvidence({
    name: id.name,
    domain: id.domain,
    countryCode: id.countryCode,
    identifiers: [{ scheme: 'PARTNER', value: id.sid }],
  });
  return { companyId, status, method, evidence: evidence as unknown as Json, evidenceHash: hash };
}

function bindingCandidate(
  sid: string,
  companyId: string,
  status: 'RESOLVED' | 'REVIEW_REQUIRED',
  method: string,
  id: SourceIdentity,
  before: BindingState | null,
): BindingCandidate {
  const after = bindingState(companyId, status, method, id);
  return { sourceId: sid, companyId, status, method, evidence: after.evidence, evidenceHash: after.evidenceHash, before };
}

function revisionOp(ctx: GroupContext, companyId: string, action: 'REPAIR' | 'UPDATE', field: string, before: Json, after: Json, salt: string): Op {
  return {
    op: 'appendRevision',
    id: repairId('r', ctx.fingerprint, companyId, action, field, salt),
    companyId,
    action,
    field,
    before,
    after,
    actorSource: REPAIR_SOURCE,
  };
}

/** The value a source record states for one company column (as ingest maps it). */
function sourceValue(row: CompanyRow, field: (typeof RESTORABLE_FIELDS)[number]): Json {
  const site = websiteUrl(row.website);
  const f = companyFacts(row);
  switch (field) {
    case 'domain':
      return identifyingDomain(site);
    case 'websiteUrl':
      return site;
    case 'primarySector':
      return row.industry ? (PARTNER_SECTOR_MAP[row.industry] ?? null) : null;
    case 'operatingStatus':
      return row.status === 'Active' ? 'Active' : null;
    case 'countryCode':
      return f.countryCode;
    case 'hq':
      return f.hq;
    case 'industry':
      return f.industry;
    default:
      return null;
  }
}

/** A field whose current value the partner provably wrote over a blank, with
 *  no later writer: the latest revision is that partner fill and still holds. */
function restorable(ev: Evidence, x: CompanyEv, field: string): { before: Json } | null {
  const revs = ev.revisions
    .filter((r) => r.entityType === 'company' && r.entityId === x.id && r.field === field)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const last = revs[revs.length - 1];
  if (!last || last.action !== 'UPDATE' || last.actor !== 'INGEST' || last.actorSource !== REPAIR_SOURCE) return null;
  const current = (x as unknown as Record<string, Json>)[field];
  if (!sameJson(last.after as Json, current)) return null;
  if (!isBlank(last.before as Json)) return null;
  return { before: last.before as Json };
}

function isBlank(v: Json): boolean {
  return v === null || v === '' || v === 'Undisclosed' || v === 0 || (Array.isArray(v) && v.length === 0);
}

function sameJson(a: Json | undefined, b: Json | undefined): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

/** A new company for one separated identity, as a fresh partner create would
 *  write it — its own sanitized prose, its own facts, partner-only provenance.
 *  The total is the stored sum of its moved rounds: money is never recomputed. */
export function destinationData(row: CompanyRow, deals: DealRow[], slug: string, totalRaisedUsd: bigint): Record<string, Json> {
  const site = websiteUrl(row.website);
  const domain = identifyingDomain(site);
  const description = cleanProse(row.about);
  const { industry, hq, countryCode } = companyFacts(row);
  const completed = deals.filter((d) => d.status === 'Completed');
  const company = {
    name: row.name.trim(),
    hq,
    foundedYear: 0,
    industry,
    stage: companyStage(completed),
    totalRaisedUsd: Number(totalRaisedUsd),
    ...(site ? { websiteUrl: site } : {}),
    ...(domain ? { domain } : {}),
    primarySector: row.industry ? (PARTNER_SECTOR_MAP[row.industry] ?? null) : null,
    oneLiner: oneLinerOf(description),
    description: description ?? '',
    countryCode,
    operatingStatus: row.status === 'Active' ? ('Active' as const) : null,
  };
  const partnerFields = [...new Set(suppliedCompanyFields(company).filter((f) => f !== 'name'))];
  return {
    slug,
    name: company.name,
    domain: domain ?? '',
    websiteUrl: site,
    linkedinUrl: null,
    legalName: null,
    operatingStatus: company.operatingStatus,
    companyType: null,
    primarySector: company.primarySector,
    countryCode,
    oneLiner: company.oneLiner,
    description: company.description,
    hq,
    founded: 0,
    headcount: 0,
    industry,
    status: 'Private',
    stage: company.stage,
    totalRaisedUsd: totalRaisedUsd.toString(),
    partnerFields,
    partnerOnly: true,
    externalSource: REPAIR_SOURCE,
    externalId: row.company_id,
    moderationStatus: 'APPROVED',
  };
}

/** Batch binding candidates into journaled groups. */
export function bindingGroups(
  kind: 'certify' | 'hold',
  candidates: BindingCandidate[],
  observed: (batch: BindingCandidate[]) => string,
  limit: number | null,
): PlannedGroup[] {
  // Company-major order, and a batch never splits one company's source ids:
  // each batch's after-state then covers everything it wrote, untouched by the next.
  const sorted = [...candidates].sort((a, b) => a.companyId.localeCompare(b.companyId) || a.sourceId.localeCompare(b.sourceId));
  const batches: BindingCandidate[][] = [];
  let current: BindingCandidate[] = [];
  for (let i = 0; i < sorted.length; i++) {
    current.push(sorted[i]!);
    const next = sorted[i + 1];
    if (current.length >= BINDING_BATCH && (!next || next.companyId !== sorted[i]!.companyId)) {
      batches.push(current);
      current = [];
    }
  }
  if (current.length) batches.push(current);
  const groups: PlannedGroup[] = [];
  for (const batch of limit === null ? batches : batches.slice(0, limit)) {
    groups.push({
      key: `${kind}:${batch[0]!.companyId}:${batch[0]!.sourceId}..${batch[batch.length - 1]!.companyId}:${batch[batch.length - 1]!.sourceId}`,
      kind,
      companyIds: [...new Set(batch.map((b) => b.companyId))].sort(),
      sourceIds: batch.map((b) => b.sourceId).sort(),
      observedHash: observed(batch),
      probe: { slugs: [], createIds: [] },
      ops: batch.map((b) => ({
        op: 'upsertBinding',
        source: REPAIR_SOURCE,
        sourceCompanyId: b.sourceId,
        before: b.before,
        after: { companyId: b.companyId, status: b.status, method: b.method, evidence: b.evidence, evidenceHash: b.evidenceHash },
      })),
      expect: { rounds: 0, holdings: 0, amountUsd: '0', totals: {}, slugs: {} },
    });
  }
  return groups;
}

/** The light evidence a binding batch is checked against: each source id's
 *  identifier still on its company, the company live, the binding unchanged. */
export async function bindingBatchEvidence(q: Q, batch: { sourceId: string; companyId: string }[], bindingsTable: boolean): Promise<string> {
  const sids = batch.map((b) => b.sourceId);
  const ids = [...new Set(batch.map((b) => b.companyId))];
  const { rows: idents } = await q.query<{ value: string; entityId: string }>(
    `SELECT value, "entityId" FROM "EntityIdentifier" WHERE "entityType" = 'company' AND scheme = 'PARTNER' AND value = ANY($1::text[]) ORDER BY value`,
    [sids],
  );
  const { rows: live } = await q.query<{ id: string; merged: boolean; status: string }>(
    `SELECT id, "mergedIntoId" IS NOT NULL AS merged, "moderationStatus"::text AS status FROM "Company" WHERE id = ANY($1::text[]) ORDER BY id`,
    [ids],
  );
  const bindings = bindingsTable
    ? (
        await q.query<{ sourceCompanyId: string; companyId: string | null; status: string; method: string }>(
          `SELECT "sourceCompanyId", "companyId", status, method FROM "CompanyIngestBinding"
            WHERE source = 'PARTNER' AND "sourceCompanyId" = ANY($1::text[]) ORDER BY "sourceCompanyId"`,
          [sids],
        )
      ).rows
    : [];
  return sha256(canonicalJson({ idents, live, bindings }));
}

export const POLICY_VERSION = COMPANY_MATCH_POLICY_VERSION;
export type { BindingSelection };
export { roundFor };
