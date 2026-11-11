import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  normalizePersonName,
  REVIEWABLE_TYPES,
  SUBMISSION_PAGE_SIZE,
  type ChangeProposalReview,
  type CompanyEditFields,
  type InvestorEditFields,
  type InvestorProposalReview,
  type PendingSubmission,
  type PendingSubmissionsResponse,
  type ReviewableType,
  type ReviewStatus,
  type SubmissionQuery,
} from '@repo/api';
import type { Company as DbCompany, DirectoryCountScope, Prisma } from '@repo/db';

import { activeClaimIds, isActiveClaim } from '../claims/active-claim';
import { PARTNER_SOURCE } from '../gate/gate';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  toAcquisition,
  toCompany,
  toCompanyEditFields,
  toDiversity,
  toExit,
  toFundingRound,
  toInvestorHolding,
  toPerson,
} from '../companies/company.mapper';
import { pickInvestorFields } from '../investors/investor.mapper';
import {
  createRevision,
  retractRevision,
  toJsonValue,
  type RevisableType,
} from '../provenance/revision.util';
import { refreshCountsSafely } from './directory-counts';
import {
  DEFAULT_REJECTION_REASON,
  loadSubmissionNotice,
  shouldNotify,
  type SubmissionNotice,
} from './submission-notice';
import { pendingQueueStats } from './queue-alerts.service';

const submittedBy = { select: { id: true, name: true, email: true } } as const;

type Submitter = { id: string; name: string; email: string } | null;
type CompanyRef = { slug: string; name: string } | null;
type InvestorRef = { slug: string; name: string } | null;

/** The company's live values for exactly the keys a proposal touches, so the
    reviewer diffs against what the row says now (not at submit time). */
function pickCurrent(company: DbCompany, changes: CompanyEditFields): CompanyEditFields {
  const view = toCompanyEditFields(company);
  const current: CompanyEditFields = {};
  for (const key of Object.keys(changes) as (keyof CompanyEditFields)[]) {
    (current as Record<string, unknown>)[key] = view[key];
  }
  return current;
}

/** Investor update payload from a proposal diff: the whitelisted fields verbatim (the DTO
    already validated them), never anything else stored in the JSON. */
function investorDataFromChanges(changes: InvestorEditFields): Prisma.InvestorUpdateInput {
  const {
    name,
    legalName,
    type,
    hq,
    countryCode,
    websiteUrl,
    linkedinUrl,
    domain,
    description,
    foundedYear,
  } = changes;
  const data: Prisma.InvestorUpdateInput = {
    name,
    legalName,
    type,
    hq,
    countryCode,
    websiteUrl,
    linkedinUrl,
    domain,
    description,
    foundedYear,
  };
  return Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  ) as Prisma.InvestorUpdateInput;
}

/** Company update payload from a proposal diff: BigInt money conversions, all
    other whitelisted fields verbatim. */
/** The `partnerFields` update after a human edit of `fields`: those columns
    now hold a moderated value, not the partner's. Empty when none was marked. */
function withoutPartnerFields(
  current: readonly string[] | null | undefined,
  fields: readonly string[],
): { partnerFields?: string[] } {
  const marked = current ?? [];
  const kept = marked.filter((f) => !fields.includes(f));
  return kept.length === marked.length ? {} : { partnerFields: kept };
}

function companyDataFromChanges(changes: CompanyEditFields) {
  const { totalRaisedUsd, lastValuationUsd, ...rest } = changes;
  return {
    ...rest,
    ...(totalRaisedUsd !== undefined ? { totalRaisedUsd: BigInt(totalRaisedUsd) } : {}),
    ...(lastValuationUsd !== undefined
      ? { lastValuationUsd: lastValuationUsd === null ? null : BigInt(lastValuationUsd) }
      : {}),
  };
}

/** `partnerFields` after a retraction puts `fields` back; empty when all are already marked. */
function withPartnerFields(
  current: readonly string[] | null | undefined,
  fields: readonly string[],
): { partnerFields?: string[] } {
  const marked = current ?? [];
  const added = fields.filter((f) => !marked.includes(f));
  return added.length === 0 ? {} : { partnerFields: [...marked, ...added] };
}

/** The marks `withoutPartnerFields` is about to remove, recorded on the proposal so a
    retraction can restore them. `[]` (not null) when there were none. */
function clearedMarks(current: readonly string[] | null | undefined, fields: readonly string[]) {
  return (current ?? []).filter((f) => fields.includes(f));
}

/** Two field values compared as the JSON column stores them, so BigInt and number, Date
    and ISO string, and the two kinds of null all agree. */
function sameValue(a: unknown, b: unknown): boolean {
  const plain = (v: unknown) => (v === null || v === undefined ? null : toJsonValue(v));
  return JSON.stringify(plain(a)) === JSON.stringify(plain(b));
}

/** The outcome of rejecting an approved edit: what went back, and what had moved on since. */
export interface RevertResult {
  revertedFields: string[];
  skippedFields: string[];
}

/** What a moderator's decision writes on the row itself. */
interface Decision {
  status: 'APPROVED' | 'REJECTED';
  reviewedAt: Date;
  reviewedById: string;
}

function decisionData(d: Decision) {
  return { moderationStatus: d.status, reviewedAt: d.reviewedAt, reviewedById: d.reviewedById };
}

/** `claimId` when that claim is active right now (inside the decision's transaction), else
 *  null — so an approval after a revoke, a ban or a domain change is not a representative edit. */
async function claimIfActive(
  tx: Prisma.TransactionClient,
  claimId: string | null,
): Promise<string | null> {
  if (!claimId) return null;
  const claim = await tx.companyClaim.findUnique({
    where: { id: claimId },
    include: {
      user: { select: { bannedAt: true } },
      company: { select: { domain: true, mergedIntoId: true } },
    },
  });
  return claim && isActiveClaim(claim, claim.company) ? claim.id : null;
}

/** A decided row ready to record: the company whose timeline it belongs on, and
    the mapped domain object the profile showed (or now shows). */
interface DecidedRow {
  companyId: string;
  snapshot: unknown;
  /** The claim the row was submitted under (null for a company row and unclaimed rows). */
  claimId: string | null;
}

/**
 * Apply the moderator's decision to one contributed row. Returns the row for the
 * timeline when the decision changed what a profile shows — an approval published
 * it, a retraction (`record` on a rejection) took it off — else null. Runs inside
 * the caller's transaction so the status flip and its timeline entry commit
 * together.
 */
async function applyDecision(
  tx: Prisma.TransactionClient,
  type: RevisableType,
  id: string,
  decision: Decision,
  /** Map the row even on a rejection: it is a retraction of a published row. */
  retracting: boolean,
): Promise<DecidedRow | null> {
  const data = decisionData(decision);
  const approved = decision.status === 'APPROVED';
  const record = approved || retracting;

  switch (type) {
    case 'company': {
      const row = await tx.company.update({ where: { id }, data });
      // A company row anchors its own timeline (entityId === companyId).
      return record ? { companyId: row.id, snapshot: toCompany(row), claimId: null } : null;
    }
    case 'round': {
      const row = await tx.fundingRound.update({
        where: { id },
        data,
        include: { investors: true },
      });
      return record
        ? { companyId: row.companyId, snapshot: toFundingRound(row), claimId: row.claimId }
        : null;
    }
    case 'person': {
      // The role row, not the deduplicated Person — 'person' means the same
      // thing to ReviewableType as it always has.
      const row = await tx.personRole.update({ where: { id }, data });
      let personId = row.personId;

      // Approving a contributed role also resolves it to a Person, so the
      // human is reachable from /people — exactly as approving a holding
      // publishes the firm it names. Rejecting resolves nothing (and a
      // retraction leaves the Person it resolved).
      if (approved) {
        const resolved = await resolvePerson(tx, row.name);
        if (resolved && resolved !== row.personId) {
          await tx.personRole.update({ where: { id }, data: { personId: resolved } });
        }
        personId = resolved;
      }

      // A role with no company has no timeline to land on (Revision.companyId
      // is required), so it publishes without one. Only firm-officer roles are
      // company-less, and those are ingest-only — they never reach this queue.
      return record && row.companyId
        ? { companyId: row.companyId, snapshot: toPerson({ ...row, personId }), claimId: row.claimId }
        : null;
    }
    case 'investor': {
      const row = await tx.investorHolding.update({ where: { id }, data });
      // Approving a contributed holding also publishes the firm it names, so the
      // investor is reachable in the directory. Rejecting leaves the firm alone —
      // it may already back other companies.
      if (approved && row.investorId) {
        await tx.investor.updateMany({
          where: { id: row.investorId, moderationStatus: 'PENDING' },
          data: { moderationStatus: 'APPROVED' },
        });
      }
      if (!record) return null;
      // Re-read so the recorded snapshot carries the firm's post-approval slug,
      // matching what the profile will render.
      const holding = await tx.investorHolding.findUniqueOrThrow({
        where: { id },
        include: { investor: { select: { slug: true, moderationStatus: true } } },
      });
      return { companyId: row.companyId, snapshot: toInvestorHolding(holding), claimId: row.claimId };
    }
    case 'acquisition': {
      const row = await tx.acquisitionDeal.update({ where: { id }, data });
      return record
        ? { companyId: row.companyId, snapshot: toAcquisition(row), claimId: row.claimId }
        : null;
    }
    case 'exit': {
      const row = await tx.exitEvent.update({ where: { id }, data });
      return record
        ? { companyId: row.companyId, snapshot: toExit(row), claimId: row.claimId }
        : null;
    }
    case 'diversity': {
      const row = await tx.diversitySignal.update({ where: { id }, data });
      return record
        ? { companyId: row.companyId, snapshot: toDiversity(row), claimId: row.claimId }
        : null;
    }
  }
}

/**
 * Whether a row's provenance says the partner may have written fields an approval
 * unmarked — the fail-closed test for a proposal approved before its cleared marks
 * were recorded: a partner identifier, or a row only the partner knows.
 */
async function touchedByPartner(
  tx: Prisma.TransactionClient,
  entityType: 'company' | 'investor',
  entityId: string,
  partnerOnly: boolean,
): Promise<boolean> {
  if (partnerOnly) return true;
  const n = await tx.entityIdentifier.count({
    where: { entityType, entityId, scheme: PARTNER_SOURCE },
  });
  return n > 0;
}

/** The partner marks to put back on the fields a retraction restored. */
async function marksToRestore(
  tx: Prisma.TransactionClient,
  cleared: unknown,
  restored: Record<string, unknown>,
  entity: { type: 'company' | 'investor'; id: string; partnerOnly: boolean },
): Promise<string[]> {
  const reverted = Object.keys(restored);
  if (Array.isArray(cleared)) return reverted.filter((f) => cleared.includes(f));
  // Approved before the cleared marks were recorded: a partner-touched row gets every
  // restored non-null value marked again, since any of them may be the partner's.
  if (!(await touchedByPartner(tx, entity.type, entity.id, entity.partnerOnly))) return [];
  return reverted.filter((f) => restored[f] !== null && restored[f] !== undefined);
}

/**
 * The human behind a contributed role: an exact normalized-name match, or a new
 * `Person`.
 *
 * The same rule ingest applies, through the same `normalizePersonName` — two
 * definitions would mean a contributed "Jane Smith" quietly getting a second
 * row beside the ingested one. Identifier matching is deliberately absent: a
 * contributor supplies a name, never a QID.
 *
 * A tombstoned person resolves to their survivor; a SUPPRESSED one resolves to
 * nothing, and the role publishes unattached — a removal request must survive a
 * contribution as much as it survives an ingest run.
 */
async function resolvePerson(
  tx: Prisma.TransactionClient,
  name: string,
): Promise<string | null> {
  const normalizedName = normalizePersonName(name);
  if (!normalizedName) return null;

  const existing = await tx.person.findFirst({
    where: { normalizedName },
    select: { id: true, suppressedAt: true, mergedIntoId: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) {
    if (existing.suppressedAt) return null;
    return existing.mergedIntoId ?? existing.id;
  }

  // A contributed person is PENDING until the role that names them is public —
  // which it now is, so APPROVED. Slug collisions get a numeric suffix, the
  // same shape the backfill mints.
  const base = kebab(name);
  let slug = base;
  for (let n = 2; await tx.person.findUnique({ where: { slug }, select: { id: true } }); n++) {
    slug = `${base}-${n}`;
  }

  const created = await tx.person.create({
    data: { slug, name, normalizedName, moderationStatus: 'APPROVED' },
    select: { id: true },
  });
  return created.id;
}

/** Lowercase kebab-case slug ('person' when nothing survives). */
function kebab(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'person';
}

/** Two count scopes as one; null when neither names anything. */
function mergeScopes(
  a: DirectoryCountScope | null,
  b: DirectoryCountScope | null,
): DirectoryCountScope | null {
  if (!a && !b) return null;
  return {
    personIds: [...(a?.personIds ?? []), ...(b?.personIds ?? [])],
    investorIds: [...(a?.investorIds ?? []), ...(b?.investorIds ?? [])],
    companyIds: [...(a?.companyIds ?? []), ...(b?.companyIds ?? [])],
  };
}

/** The timestamp a queue page is ordered by: when the row was decided (a decided
 *  status of contributed rows), or when it was written (everything else). */
export type SubmissionSortKey = 'createdAt' | 'reviewedAt';

/** `reviewedAt` only where every row has one: contributed rows in a decided status
 *  (the moderation_review backfill made that an invariant). Ingested rows are never
 *  decided by anyone, and PENDING ones not yet. */
export function submissionSortKey(query: SubmissionQuery): SubmissionSortKey {
  const source = query.userId ? 'contributed' : (query.source ?? 'all');
  return query.status !== 'PENDING' && source === 'contributed' ? 'reviewedAt' : 'createdAt';
}

type NameFilter = { contains: string; mode: 'insensitive' };

/** "Sorts after the cursor" on the sort key — see `olderThan`. */
type CursorWhere =
  | Partial<Record<SubmissionSortKey, { lt: Date } | { lte: Date }>>
  | {
      OR: [
        Partial<Record<SubmissionSortKey, { lt: Date }>>,
        Partial<Record<SubmissionSortKey, Date>> & { id: { lt: string } },
      ];
    };

/** The filter one table gets for a queue page (or its count). One shape for all
 *  nine tables; `submissionWhere` only sets the keys a table has. */
interface SubmissionWhere {
  moderationStatus: ReviewStatus;
  claimId?: { in: string[] };
  submittedById?: string | null | { not: null };
  reviewedAt?: { not: null };
  name?: NameFilter;
  company?: { name: NameFilter };
  investor?: { name: NameFilter };
  AND?: CursorWhere[];
}

interface SubmissionCursor {
  at: Date;
  type: ReviewableType;
  id: string;
}

/** The queue's total order: newest first on the sort key, ties broken by type,
 *  then id. The cursor filter in `olderThan` must agree with it exactly. */
export function bySubmissionOrder(
  key: SubmissionSortKey,
): (a: PendingSubmission, b: PendingSubmission) => number {
  return (a, b) =>
    (b[key] ?? '').localeCompare(a[key] ?? '') ||
    (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** `<sort-key ISO>_<type>_<id>` — opaque to the web, which only echoes it (and
 *  drops it whenever a filter changes, so a cursor never crosses sort keys). */
function submissionCursor(item: PendingSubmission, key: SubmissionSortKey): string {
  return `${item[key] ?? ''}_${item.type}_${item.id}`;
}

function parseSubmissionCursor(raw: string): SubmissionCursor {
  const first = raw.indexOf('_');
  const second = raw.indexOf('_', first + 1);
  const at = new Date(raw.slice(0, first));
  const type = raw.slice(first + 1, second) as ReviewableType;
  const id = raw.slice(second + 1);
  if (first < 0 || second < 0 || Number.isNaN(at.getTime()) || !id ||
      !REVIEWABLE_TYPES.includes(type)) {
    throw new BadRequestException(`Invalid cursor "${raw}"`);
  }
  return { at, type, id };
}

/**
 * Rows of table `t` that sort after the cursor in `bySubmissionOrder`. On the
 * cursor's own timestamp, a type sorting after the cursor's keeps every row, a
 * type before it keeps none, and the cursor's own type continues by id.
 */
function olderThan(
  cursor: SubmissionCursor,
  t: ReviewableType,
  key: SubmissionSortKey,
): CursorWhere {
  const { at } = cursor;
  if (t > cursor.type) return { [key]: { lte: at } };
  if (t < cursor.type) return { [key]: { lt: at } };
  return { OR: [{ [key]: { lt: at } }, { [key]: at, id: { lt: cursor.id } }] };
}

/**
 * Table `t`'s filter for a queue query: status; who wrote it (`userId`, else
 * contributed / ingested / either); a non-null decision time when sorting by it,
 * which lets `(moderationStatus, reviewedAt, id)` bound the scan; the name of the
 * company (or firm) it belongs to; and the cursor.
 */
function submissionWhere(
  t: ReviewableType,
  query: SubmissionQuery,
  key: SubmissionSortKey,
  cursor: SubmissionCursor | null,
  /** Active claim ids when the representative filter is on (see `activeClaimIds`). */
  claimIds: string[] | null = null,
): SubmissionWhere {
  const where: SubmissionWhere = { moderationStatus: query.status };
  if (claimIds && hasClaimColumn(t)) where.claimId = { in: claimIds };
  if (query.userId) where.submittedById = query.userId;
  else if (query.source === 'contributed') where.submittedById = { not: null };
  else if (query.source === 'ingested') where.submittedById = null;
  if (key === 'reviewedAt') where.reviewedAt = { not: null };
  if (query.q) {
    const name: NameFilter = { contains: query.q, mode: 'insensitive' };
    if (t === 'company') where.name = name;
    else if (t === 'investorProposal') where.investor = { name };
    else where.company = { name };
  }
  if (cursor) where.AND = [olderThan(cursor, t, key)];
  return where;
}

/** The seven company-anchored types carry `claimId`; a new company and an investor edit have
 *  no company to represent, so the representative filter excludes them like a type filter. */
function hasClaimColumn(t: ReviewableType): boolean {
  return t !== 'company' && t !== 'investorProposal';
}

/** The claim a listed row was submitted under, kept off the public payload. */
const CLAIM_OF = new WeakMap<PendingSubmission, string>();

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** PENDING rows across every reviewable table, for the admin nav badge. One
   *  aggregate per table (the queue digest's read), never `listSubmissions`. */
  async pendingCount(): Promise<number> {
    return (await pendingQueueStats(this.prisma)).total;
  }

  /**
   * One page of the queue for a status — optionally of one type, one source,
   * one contributor, or one company/firm name — newest first, plus the true
   * per-type totals under the same filters. Never unbounded: APPROVED holds every
   * ingested row (~255k with their joins), and loading them all ran the API out
   * of heap and crashed it (2026-10-06).
   *
   * Paged by cursor (`before`, from the previous page's `nextCursor`) on the
   * order (sort key desc, type asc, id desc), the sort key being
   * `submissionSortKey`. Each table contributes its own next PAGE + 1 rows past
   * the cursor; the merged newest PAGE of those is exactly the next page, and
   * the +1 says whether another follows.
   */
  async listSubmissions(query: SubmissionQuery): Promise<PendingSubmissionsResponse> {
    const { type } = query;
    const key = submissionSortKey(query);
    const cursor = query.before ? parseSubmissionCursor(query.before) : null;
    // Resolved once, live: revoking, banning or a domain change drops a row from the filter.
    const claimIds = query.representative ? await activeClaimIds(this.prisma) : null;
    const page = {
      orderBy: [{ [key]: 'desc' as const }, { id: 'desc' as const }],
      take: SUBMISSION_PAGE_SIZE + 1,
    };
    const only = <T>(
      t: ReviewableType,
      read: (where: SubmissionWhere) => Promise<T[]>,
    ): Promise<T[]> =>
      (!type || type === t) && (!claimIds || hasClaimColumn(t))
        ? read(submissionWhere(t, query, key, cursor, claimIds))
        : Promise.resolve([]);

    const [
      companies,
      rounds,
      people,
      investors,
      acquisitions,
      exits,
      diversity,
      proposals,
      investorProposals,
      countsByType,
    ] = await Promise.all([
      only('company', (where) =>
        this.prisma.company.findMany({ where, include: { submittedBy }, ...page }),
      ),
      only('round', (where) =>
        this.prisma.fundingRound.findMany({
          where,
          include: { submittedBy, company: true, investors: true },
          ...page,
        }),
      ),
      only('person', (where) =>
        this.prisma.personRole.findMany({ where, include: { submittedBy, company: true }, ...page }),
      ),
      only('investor', (where) =>
        this.prisma.investorHolding.findMany({
          where,
          include: { submittedBy, company: true },
          ...page,
        }),
      ),
      only('acquisition', (where) =>
        this.prisma.acquisitionDeal.findMany({
          where,
          include: { submittedBy, company: true },
          ...page,
        }),
      ),
      only('exit', (where) =>
        this.prisma.exitEvent.findMany({ where, include: { submittedBy, company: true }, ...page }),
      ),
      only('diversity', (where) =>
        this.prisma.diversitySignal.findMany({
          where,
          include: { submittedBy, company: true },
          ...page,
        }),
      ),
      only('proposal', (where) =>
        this.prisma.changeProposal.findMany({
          where,
          include: { submittedBy, company: true },
          ...page,
        }),
      ),
      only('investorProposal', (where) =>
        this.prisma.investorChangeProposal.findMany({
          where,
          include: { submittedBy, investor: true },
          ...page,
        }),
      ),
      this.countSubmissions(query, key, claimIds),
    ]);

    const items: PendingSubmission[] = [
      ...companies.map((c) =>
        this.item('company', c, { slug: c.slug, name: c.name }, c.name, toCompany(c)),
      ),
      ...rounds.map((r) =>
        this.item('round', r, r.company, `${r.name} round`, toFundingRound(r)),
      ),
      ...people.map((p) => this.item('person', p, p.company, p.name, toPerson(p))),
      ...investors.map((i) => this.item('investor', i, i.company, i.name, toInvestorHolding(i))),
      ...acquisitions.map((a) =>
        this.item('acquisition', a, a.company, `Acquired ${a.target}`, toAcquisition(a)),
      ),
      ...exits.map((e) => this.item('exit', e, e.company, `${e.type} exit`, toExit(e))),
      ...diversity.map((d) => this.item('diversity', d, d.company, d.label, toDiversity(d))),
      ...proposals.map((p) => {
        const changes = p.changes as CompanyEditFields;
        const review: ChangeProposalReview = {
          changes,
          current: pickCurrent(p.company, changes),
          note: p.note,
        };
        return this.item(
          'proposal',
          p,
          p.company,
          `Edit ${Object.keys(changes).join(', ')}`,
          review,
          // A proposal holds its URL on the row; its citations are only minted
          // on approval, so there is nothing to look up yet.
          p.sourceUrl,
        );
      }),
      ...investorProposals.map((p) => {
        const changes = p.changes as InvestorEditFields;
        const firm = { slug: p.investor.slug, name: p.investor.name };
        const review: InvestorProposalReview = {
          investor: firm,
          changes,
          current: pickInvestorFields(p.investor, changes),
          previous: (p.previous as InvestorEditFields | null) ?? null,
          note: p.note,
        };
        return this.item(
          'investorProposal',
          p,
          null,
          `Edit ${Object.keys(changes).join(', ')} · ${p.investor.name}`,
          review,
          // Firm-level citations don't exist; the URL only ever lives on the row.
          p.sourceUrl,
          firm,
        );
      }),
    ].sort(bySubmissionOrder(key));

    const hasMore = items.length > SUBMISSION_PAGE_SIZE;
    items.length = Math.min(items.length, SUBMISSION_PAGE_SIZE);
    await Promise.all([
      this.fillCitedSources(items),
      this.fillReviewers(items),
      this.fillRepresentatives(items),
    ]);

    const total = type
      ? countsByType[type]
      : Object.values(countsByType).reduce((sum, n) => sum + n, 0);
    const last = items[items.length - 1];
    return {
      total,
      countsByType,
      items,
      nextCursor: hasMore && last ? submissionCursor(last, key) : null,
    };
  }

  /** Rows per type under the query's filters (never its cursor) — one `count`
   *  per table, never the rows — so the type pills match the filtered view. */
  private async countSubmissions(
    query: SubmissionQuery,
    key: SubmissionSortKey,
    claimIds: string[] | null,
  ): Promise<Record<ReviewableType, number>> {
    const where = (t: ReviewableType) => submissionWhere(t, query, key, null, claimIds);
    const none = Promise.resolve(0);
    const [
      company,
      round,
      person,
      investor,
      acquisition,
      exit,
      diversity,
      proposal,
      investorProposal,
    ] = await Promise.all([
      claimIds ? none : this.prisma.company.count({ where: where('company') }),
      this.prisma.fundingRound.count({ where: where('round') }),
      this.prisma.personRole.count({ where: where('person') }),
      this.prisma.investorHolding.count({ where: where('investor') }),
      this.prisma.acquisitionDeal.count({ where: where('acquisition') }),
      this.prisma.exitEvent.count({ where: where('exit') }),
      this.prisma.diversitySignal.count({ where: where('diversity') }),
      this.prisma.changeProposal.count({ where: where('proposal') }),
      claimIds
        ? none
        : this.prisma.investorChangeProposal.count({ where: where('investorProposal') }),
    ]);
    return {
      company,
      round,
      person,
      investor,
      acquisition,
      exit,
      diversity,
      proposal,
      investorProposal,
    };
  }

  async moderate(
    type: ReviewableType,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    adminUserId: string,
    /** The moderator's reason, quoted in a rejection email. Not stored. */
    note?: string | null,
  ) {
    let notice: SubmissionNotice | null;
    let countsBefore: DirectoryCountScope | null;
    let reverted: RevertResult | null = null;
    const decision: Decision = { status, reviewedAt: new Date(), reviewedById: adminUserId };
    try {
      // Read before deciding: the email describes the row, and the prior status
      // is what tells a real decision from a repeat click — and a rejection of
      // something already published (a retraction) from a first decision.
      notice = await loadSubmissionNotice(this.prisma, type, id);
      const retracting = status === 'REJECTED' && notice?.status === 'APPROVED';
      // Before as well as after: approving a role can re-point it at another
      // Person (resolvePerson), whose count it then leaves.
      countsBefore = await this.countScope(type, id);
      if (type === 'proposal') {
        if (status === 'APPROVED') {
          await this.applyProposal(id, decision);
        } else if (retracting) {
          reverted = await this.revertProposal(id, decision);
        } else {
          await this.prisma.changeProposal.update({ where: { id }, data: decisionData(decision) });
        }
      } else if (type === 'investorProposal') {
        if (status === 'APPROVED') {
          await this.applyInvestorProposal(id, decision);
        } else if (retracting) {
          reverted = await this.revertInvestorProposal(id, decision);
        } else {
          await this.prisma.investorChangeProposal.update({
            where: { id },
            data: decisionData(decision),
          });
        }
      } else {
        await this.moderateRow(type, id, decision, retracting);
      }
    } catch {
      throw new NotFoundException(`${type} "${id}" not found`);
    }
    if (reverted?.skippedFields.length) {
      this.logger.log(
        `Retracted ${type} ${id}: kept ${reverted.skippedFields.join(', ')} ` +
          '(changed again since the approval)',
      );
    }
    // After the commit, and awaited, so the admin's next directory page is
    // already in order. Both directions: an approved row can be re-rejected.
    const counts = mergeScopes(countsBefore, await this.countScope(type, id));
    if (counts) await refreshCountsSafely(this.prisma, counts, this.logger);
    // Only once the decision has committed — and never awaited, so mail being
    // slow or down can't hold up, fail or roll back the moderation.
    if (shouldNotify(notice, status)) this.notifySubmitter(notice, status, note);
    return { id, type, moderationStatus: status, ...(reverted ?? {}) };
  }

  /** The directory sort keys (refreshDirectoryCounts) a decision on this row can
   *  move: a role's person, a holding's firm, and a company's people and firms
   *  (its status gates every role and holding on it). Nothing else counts. */
  private async countScope(type: ReviewableType, id: string): Promise<DirectoryCountScope | null> {
    switch (type) {
      case 'person': {
        const row = await this.prisma.personRole.findUnique({ where: { id }, select: { personId: true } });
        return row?.personId ? { personIds: [row.personId] } : null;
      }
      case 'investor': {
        const row = await this.prisma.investorHolding.findUnique({ where: { id }, select: { investorId: true } });
        return row?.investorId ? { investorIds: [row.investorId] } : null;
      }
      case 'company':
        return { companyIds: [id] };
      default:
        return null;
    }
  }

  /** Email the contributor about a decision. Never throws; failures are logged
      (and reported to GlitchTip by MailService). */
  private notifySubmitter(
    notice: SubmissionNotice & { submitter: NonNullable<SubmissionNotice['submitter']> },
    status: 'APPROVED' | 'REJECTED',
    note: string | null | undefined,
  ): void {
    const { email, name } = notice.submitter;
    try {
      const sent =
        status === 'APPROVED'
          ? this.mail.sendSubmissionApprovedEmail(email, name, notice.summary, notice.viewPath)
          : this.mail.sendSubmissionRejectedEmail(
              email,
              name,
              notice.summary,
              note?.trim() || DEFAULT_REJECTION_REASON,
              notice.retryPath,
            );
      sent.catch((err: unknown) => this.logNotifyFailure(err));
    } catch (err) {
      this.logNotifyFailure(err);
    }
  }

  private logNotifyFailure(err: unknown): void {
    this.logger.error(
      'Failed to email a contributor about a moderation decision',
      err instanceof Error ? err.stack : String(err),
    );
  }

  /** Flip a contributed row's moderation status. An APPROVED row has just
      become public, so it also gets a CREATE entry on the company's timeline;
      a rejected row that was public (a retraction) gets a RETRACT entry; one
      that never was public gets none. */
  private async moderateRow(
    type: RevisableType,
    id: string,
    decision: Decision,
    retracting: boolean,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const decided = await applyDecision(tx, type, id, decision, retracting);
      if (!decided) return;
      const entry = { companyId: decided.companyId, entityType: type, entityId: id };
      await tx.revision.create({
        data:
          decision.status === 'APPROVED'
            ? createRevision({
                ...entry,
                after: decided.snapshot,
                actorUserId: decision.reviewedById,
                // A representative edit only while the claim is active at approval time.
                claimId: await claimIfActive(tx, decided.claimId),
              })
            : retractRevision({
                ...entry,
                before: decided.snapshot,
                actorUserId: decision.reviewedById,
              }),
      });
    });
  }

  /** Approving a proposal applies its diff to the Company row and flips the
      proposal's status, atomically. Re-approving re-applies the same values
      (and records a second, no-op revision — a faithful record of the action). */
  private async applyProposal(id: string, decision: Decision) {
    const adminUserId = decision.reviewedById;
    await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.changeProposal.findUniqueOrThrow({
        where: { id },
        include: { company: true },
      });
      const changes = proposal.changes as CompanyEditFields;
      // Captured inside the transaction, before the update — this is the whole
      // point: applying the diff destroys the values it replaces.
      const before = pickCurrent(proposal.company, changes);
      const fields = Object.keys(changes) as (keyof CompanyEditFields)[];
      // Checked against the domain BEFORE this diff: a representative's own domain edit is
      // still theirs.
      const claimId = await claimIfActive(tx, proposal.claimId);

      await tx.company.update({
        where: { id: proposal.companyId },
        data: {
          ...companyDataFromChanges(changes),
          // A human value replaced whatever the partner wrote there. (The
          // history still withholds the field from locked viewers: its earlier
          // revisions carry the partner's value.)
          ...withoutPartnerFields(proposal.company.partnerFields, fields),
        },
      });
      await tx.changeProposal.update({
        where: { id },
        data: {
          ...decisionData(decision),
          // What withoutPartnerFields just removed, for revertProposal to put back.
          clearedPartnerFields: clearedMarks(proposal.company.partnerFields, fields),
        },
      });

      await tx.revision.createMany({
        data: fields.map((field) => ({
          companyId: proposal.companyId,
          entityType: 'company',
          entityId: proposal.companyId,
          field: String(field),
          before: toJsonValue(before[field]),
          after: toJsonValue(changes[field]),
          action: 'UPDATE',
          actor: 'ADMIN',
          actorUserId: adminUserId,
          proposalId: proposal.id,
          claimId,
        })),
      });

      if (proposal.sourceUrl) {
        const source = await tx.source.upsert({
          where: { url: proposal.sourceUrl },
          // A contributor's link is unclassified: we have not fetched it.
          create: { url: proposal.sourceUrl, sourceType: 'Other', retrievedAt: new Date() },
          update: {},
          select: { id: true },
        });
        // One citation per changed field — this is where "field-level citation"
        // stops being a name and starts being the thing.
        await tx.citation.createMany({
          data: fields.map((field) => ({
            sourceId: source.id,
            entityType: 'company',
            entityId: proposal.companyId,
            field: String(field),
            submittedById: proposal.submittedById,
          })),
          skipDuplicates: true,
        });
      }
    });
  }

  /**
   * Approving an investor proposal applies its diff to the Investor row and keeps the values it
   * replaced on the proposal (`previous`), atomically. No Revision (Revision.companyId is
   * required; a firm has no company) and no Citation (no firm-level citable type) — the proposal
   * row is the record. Re-approving re-applies the diff and overwrites `previous` with the
   * then-current values, like a re-approved company proposal records a no-op revision.
   */
  private async applyInvestorProposal(id: string, decision: Decision) {
    await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.investorChangeProposal.findUniqueOrThrow({
        where: { id },
        include: { investor: true },
      });
      const changes = proposal.changes as InvestorEditFields;
      const fields = Object.keys(changes);
      // Captured inside the transaction, before the update: the diff destroys what it replaces.
      const previous = pickInvestorFields(proposal.investor, changes);
      await tx.investor.update({
        where: { id: proposal.investorId },
        data: {
          ...investorDataFromChanges(changes),
          ...withoutPartnerFields(proposal.investor.partnerFields, fields),
        },
      });
      await tx.investorChangeProposal.update({
        where: { id },
        data: {
          ...decisionData(decision),
          previous: previous as Prisma.InputJsonValue,
          clearedPartnerFields: clearedMarks(proposal.investor.partnerFields, fields),
        },
      });
    });
  }

  /**
   * Rejecting an approved company edit undoes it, field by field, atomically.
   *
   * A field goes back to the value the approval replaced (its newest real UPDATE
   * revision under this proposal) only while the company still shows the
   * proposal's value; one changed again since — a later edit, an ingest — keeps
   * its newer value and is reported as skipped. Restored fields get back the
   * partner marks the approval removed (so a partner value is masked again), one
   * RETRACT revision each, and lose the citations the approval minted for them
   * unless another approved proposal cites the same source for the same field.
   */
  private async revertProposal(id: string, decision: Decision): Promise<RevertResult> {
    return this.prisma.$transaction(async (tx) => {
      const proposal = await tx.changeProposal.findUniqueOrThrow({
        where: { id },
        include: { company: true },
      });
      const { company } = proposal;
      const changes = proposal.changes as CompanyEditFields;
      const current = toCompanyEditFields(company) as Record<string, unknown>;
      const revisions = await tx.revision.findMany({
        where: { proposalId: id, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
        select: { field: true, before: true, after: true },
      });

      const restored: Record<string, unknown> = {};
      const skippedFields: string[] = [];
      for (const [field, value] of Object.entries(changes)) {
        const mine = revisions.filter((r) => r.field === field);
        // A re-approval while still applied records before === after; the value
        // to go back to is in the newest entry that actually changed something.
        const replaced = mine.find((r) => !sameValue(r.before, r.after)) ?? mine[0];
        if (!replaced || !sameValue(current[field], value)) {
          skippedFields.push(field);
        } else if (!sameValue(replaced.before, value)) {
          restored[field] = replaced.before;
        }
      }
      const revertedFields = Object.keys(restored);

      if (revertedFields.length > 0) {
        const marks = await marksToRestore(tx, proposal.clearedPartnerFields, restored, {
          type: 'company',
          id: company.id,
          partnerOnly: company.partnerOnly,
        });
        await tx.company.update({
          where: { id: company.id },
          data: {
            ...companyDataFromChanges(restored as CompanyEditFields),
            ...withPartnerFields(company.partnerFields, marks),
          },
        });
        await tx.revision.createMany({
          data: revertedFields.map((field) => ({
            companyId: company.id,
            entityType: 'company',
            entityId: company.id,
            field,
            before: toJsonValue(current[field]),
            after: toJsonValue(restored[field]),
            action: 'RETRACT',
            actor: 'ADMIN',
            actorUserId: decision.reviewedById,
            proposalId: id,
          })),
        });
        await this.deleteProposalCitations(tx, proposal, revertedFields);
      }

      await tx.changeProposal.update({ where: { id }, data: decisionData(decision) });
      return { revertedFields, skippedFields };
    });
  }

  /** The field citations an approval minted from `proposal.sourceUrl`, for the fields
      it no longer stands behind — kept where another approved proposal on the company
      cites the same URL for that field. */
  private async deleteProposalCitations(
    tx: Prisma.TransactionClient,
    proposal: { id: string; companyId: string; sourceUrl: string | null; submittedById: string | null },
    fields: string[],
  ): Promise<void> {
    if (!proposal.sourceUrl) return;
    const source = await tx.source.findUnique({
      where: { url: proposal.sourceUrl },
      select: { id: true },
    });
    if (!source) return;
    const others = await tx.changeProposal.findMany({
      where: {
        companyId: proposal.companyId,
        sourceUrl: proposal.sourceUrl,
        moderationStatus: 'APPROVED',
        id: { not: proposal.id },
      },
      select: { changes: true },
    });
    const stillCited = new Set(others.flatMap((p) => Object.keys(p.changes as CompanyEditFields)));
    const drop = fields.filter((f) => !stillCited.has(f));
    if (drop.length === 0) return;
    await tx.citation.deleteMany({
      where: {
        sourceId: source.id,
        entityType: 'company',
        entityId: proposal.companyId,
        field: { in: drop },
        submittedById: proposal.submittedById,
      },
    });
  }

  /** `revertProposal` for an investor-firm edit: the same compare-and-restore against
      the `previous` values the approval kept, and the same partner re-marks. No
      revision and no citation, as on approval. */
  private async revertInvestorProposal(id: string, decision: Decision): Promise<RevertResult> {
    return this.prisma.$transaction(async (tx) => {
      const proposal = await tx.investorChangeProposal.findUniqueOrThrow({
        where: { id },
        include: { investor: true },
      });
      const { investor } = proposal;
      const changes = proposal.changes as InvestorEditFields;
      const current = pickInvestorFields(investor, changes) as Record<string, unknown>;
      const previous = (proposal.previous ?? {}) as Record<string, unknown>;

      const restored: Record<string, unknown> = {};
      const skippedFields: string[] = [];
      for (const [field, value] of Object.entries(changes)) {
        if (!(field in previous) || !sameValue(current[field], value)) {
          skippedFields.push(field);
        } else if (!sameValue(previous[field], value)) {
          restored[field] = previous[field];
        }
      }
      const revertedFields = Object.keys(restored);

      if (revertedFields.length > 0) {
        const marks = await marksToRestore(tx, proposal.clearedPartnerFields, restored, {
          type: 'investor',
          id: investor.id,
          partnerOnly: investor.partnerOnly,
        });
        await tx.investor.update({
          where: { id: investor.id },
          data: {
            ...investorDataFromChanges(restored as InvestorEditFields),
            ...withPartnerFields(investor.partnerFields, marks),
          },
        });
      }

      await tx.investorChangeProposal.update({ where: { id }, data: decisionData(decision) });
      return { revertedFields, skippedFields };
    });
  }

  /** Fill in the source each contributed row cites, so a moderator can check it
      before approving. One query for the whole queue; proposals already carry
      theirs on the row. */
  private async fillCitedSources(items: PendingSubmission[]): Promise<void> {
    const pending = items.filter(
      (i) => i.sourceUrl === null && i.type !== 'proposal' && i.type !== 'investorProposal',
    );
    if (pending.length === 0) return;

    const citations = await this.prisma.citation.findMany({
      where: { entityId: { in: pending.map((i) => i.id) }, field: '' },
      select: { entityId: true, source: { select: { url: true } } },
    });
    const byEntity = new Map(citations.map((c) => [c.entityId, c.source.url]));
    for (const item of pending) item.sourceUrl = byEntity.get(item.id) ?? null;
  }

  /** Name the admin behind each decided row: one lookup per page. `reviewedById`
      is a plain column (users are never deleted), so it is resolved here rather
      than joined. */
  private async fillReviewers(items: PendingSubmission[]): Promise<void> {
    const ids = [...new Set(items.map((i) => i.reviewedBy?.id).filter((id): id is string => !!id))];
    if (ids.length === 0) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const item of items) {
      if (item.reviewedBy) item.reviewedBy = byId.get(item.reviewedBy.id) ?? null;
    }
  }

  /** Label each row submitted under a claim that is active NOW: one query for the page's
      claims (their users and companies included), checked with the one `isActiveClaim`. */
  private async fillRepresentatives(items: PendingSubmission[]): Promise<void> {
    const ids = [...new Set(items.map((i) => CLAIM_OF.get(i)).filter((id): id is string => !!id))];
    if (ids.length === 0) return;
    const claims = await this.prisma.companyClaim.findMany({
      where: { id: { in: ids } },
      include: {
        user: { select: { bannedAt: true } },
        company: { select: { domain: true, mergedIntoId: true } },
      },
    });
    const active = new Set(claims.filter((c) => isActiveClaim(c, c.company)).map((c) => c.id));
    for (const item of items) {
      const claimId = CLAIM_OF.get(item);
      item.representative = claimId !== undefined && active.has(claimId);
    }
  }

  private item(
    type: ReviewableType,
    row: {
      id: string;
      moderationStatus: ReviewStatus;
      createdAt: Date;
      submittedBy?: Submitter;
      reviewedAt?: Date | null;
      reviewedById?: string | null;
      claimId?: string | null;
    },
    company: CompanyRef,
    label: string,
    data: unknown,
    sourceUrl: string | null = null,
    investor: InvestorRef = null,
  ): PendingSubmission {
    const item: PendingSubmission = {
      type,
      id: row.id,
      label,
      companySlug: company?.slug ?? null,
      companyName: company?.name ?? null,
      investorSlug: investor?.slug ?? null,
      investorName: investor?.name ?? null,
      moderationStatus: row.moderationStatus,
      submittedBy: row.submittedBy ?? null,
      createdAt: row.createdAt.toISOString(),
      sourceUrl,
      data,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      // Only the id until fillReviewers names it.
      reviewedBy: row.reviewedById ? { id: row.reviewedById, name: '' } : null,
      // Until fillRepresentatives checks the claim.
      representative: false,
    };
    if (row.claimId) CLAIM_OF.set(item, row.claimId);
    return item;
  }
}
