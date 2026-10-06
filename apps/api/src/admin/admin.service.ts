import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  normalizePersonName,
  REVIEWABLE_TYPES,
  SUBMISSION_PAGE_SIZE,
  type ChangeProposalReview,
  type CompanyEditFields,
  type PendingSubmission,
  type PendingSubmissionsResponse,
  type ReviewableType,
  type ReviewStatus,
} from '@repo/api';
import type { Company as DbCompany, Prisma } from '@repo/db';

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
import { createRevision, toJsonValue, type RevisableType } from '../provenance/revision.util';
import {
  DEFAULT_REJECTION_REASON,
  loadSubmissionNotice,
  shouldNotify,
  type SubmissionNotice,
} from './submission-notice';

const submittedBy = { select: { id: true, name: true, email: true } } as const;

type Submitter = { id: string; name: string; email: string } | null;
type CompanyRef = { slug: string; name: string } | null;

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

/** Company update payload from a proposal diff: BigInt money conversions, all
    other whitelisted fields verbatim. */
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

/** The row a just-approved contribution published, ready to record: the company
    whose timeline it belongs on, and the mapped domain object it now shows. */
interface PublishedRow {
  companyId: string;
  after: unknown;
}

/**
 * Apply the moderator's decision to one contributed row, returning what became
 * public — or null when the decision was REJECTED and nothing did. Runs inside
 * the caller's transaction so the status flip and its timeline entry commit
 * together.
 */
async function applyDecision(
  tx: Prisma.TransactionClient,
  type: RevisableType,
  id: string,
  status: 'APPROVED' | 'REJECTED',
): Promise<PublishedRow | null> {
  const data = { moderationStatus: status };
  const approved = status === 'APPROVED';

  switch (type) {
    case 'company': {
      const row = await tx.company.update({ where: { id }, data });
      // A company row anchors its own timeline (entityId === companyId).
      return approved ? { companyId: row.id, after: toCompany(row) } : null;
    }
    case 'round': {
      const row = await tx.fundingRound.update({
        where: { id },
        data,
        include: { investors: true },
      });
      return approved ? { companyId: row.companyId, after: toFundingRound(row) } : null;
    }
    case 'person': {
      // The role row, not the deduplicated Person — 'person' means the same
      // thing to ReviewableType as it always has.
      const row = await tx.personRole.update({ where: { id }, data });
      if (!approved) return null;

      // Approving a contributed role also resolves it to a Person, so the
      // human is reachable from /people — exactly as approving a holding
      // publishes the firm it names. Rejecting resolves nothing.
      const personId = await resolvePerson(tx, row.name);
      if (personId && personId !== row.personId) {
        await tx.personRole.update({ where: { id }, data: { personId } });
      }

      // A role with no company has no timeline to land on (Revision.companyId
      // is required), so it publishes without one. Only firm-officer roles are
      // company-less, and those are ingest-only — they never reach this queue.
      return row.companyId
        ? { companyId: row.companyId, after: toPerson({ ...row, personId }) }
        : null;
    }
    case 'investor': {
      const row = await tx.investorHolding.update({ where: { id }, data });
      if (!approved) return null;
      // Approving a contributed holding also publishes the firm it names, so the
      // investor is reachable in the directory. Rejecting leaves the firm alone —
      // it may already back other companies.
      if (row.investorId) {
        await tx.investor.updateMany({
          where: { id: row.investorId, moderationStatus: 'PENDING' },
          data: { moderationStatus: 'APPROVED' },
        });
      }
      // Re-read so the recorded snapshot carries the firm's post-approval slug,
      // matching what the profile will render.
      const holding = await tx.investorHolding.findUniqueOrThrow({
        where: { id },
        include: { investor: { select: { slug: true, moderationStatus: true } } },
      });
      return { companyId: row.companyId, after: toInvestorHolding(holding) };
    }
    case 'acquisition': {
      const row = await tx.acquisitionDeal.update({ where: { id }, data });
      return approved ? { companyId: row.companyId, after: toAcquisition(row) } : null;
    }
    case 'exit': {
      const row = await tx.exitEvent.update({ where: { id }, data });
      return approved ? { companyId: row.companyId, after: toExit(row) } : null;
    }
    case 'diversity': {
      const row = await tx.diversitySignal.update({ where: { id }, data });
      return approved ? { companyId: row.companyId, after: toDiversity(row) } : null;
    }
  }
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

/** The filter one table gets for a queue page: its status, plus "older than
 *  the cursor" when paging. */
interface SubmissionWhere {
  moderationStatus: ReviewStatus;
  createdAt?: { lt: Date } | { lte: Date };
  OR?: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }];
}

interface SubmissionCursor {
  createdAt: Date;
  type: ReviewableType;
  id: string;
}

/** The queue's total order: newest first, ties broken by type, then id. The
 *  cursor filter in `olderThan` must agree with it exactly. */
function bySubmissionOrder(a: PendingSubmission, b: PendingSubmission): number {
  return (
    b.createdAt.localeCompare(a.createdAt) ||
    (a.type < b.type ? -1 : a.type > b.type ? 1 : 0) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

/** `<createdAt ISO>_<type>_<id>` — opaque to the web, which only echoes it. */
function submissionCursor(item: PendingSubmission): string {
  return `${item.createdAt}_${item.type}_${item.id}`;
}

function parseSubmissionCursor(raw: string): SubmissionCursor {
  const first = raw.indexOf('_');
  const second = raw.indexOf('_', first + 1);
  const createdAt = new Date(raw.slice(0, first));
  const type = raw.slice(first + 1, second) as ReviewableType;
  const id = raw.slice(second + 1);
  if (first < 0 || second < 0 || Number.isNaN(createdAt.getTime()) || !id ||
      !REVIEWABLE_TYPES.includes(type)) {
    throw new BadRequestException(`Invalid cursor "${raw}"`);
  }
  return { createdAt, type, id };
}

/**
 * Rows of table `t` that sort after the cursor in `bySubmissionOrder`. On the
 * cursor's own timestamp, a type sorting after the cursor's keeps every row, a
 * type before it keeps none, and the cursor's own type continues by id.
 */
function olderThan(cursor: SubmissionCursor | null, t: ReviewableType): Partial<SubmissionWhere> {
  if (!cursor) return {};
  const at = cursor.createdAt;
  if (t > cursor.type) return { createdAt: { lte: at } };
  if (t < cursor.type) return { createdAt: { lt: at } };
  return { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }] };
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * One page of the queue for a status — optionally of one type — newest first,
   * plus the true per-type totals. Never unbounded: APPROVED holds every
   * ingested row (~255k with their joins), and loading them all ran the API out
   * of heap and crashed it (2026-10-06).
   *
   * Paged by cursor (`before`, from the previous page's `nextCursor`) on the
   * order (createdAt desc, type asc, id desc). Each table contributes its own
   * next PAGE + 1 rows past the cursor; the merged newest PAGE of those is
   * exactly the next page, and the +1 says whether another follows.
   */
  async listSubmissions(
    status: ReviewStatus,
    type?: ReviewableType,
    before?: string,
  ): Promise<PendingSubmissionsResponse> {
    const cursor = before ? parseSubmissionCursor(before) : null;
    const page = {
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: SUBMISSION_PAGE_SIZE + 1,
    };
    const only = <T>(
      t: ReviewableType,
      query: (where: SubmissionWhere) => Promise<T[]>,
    ): Promise<T[]> =>
      !type || type === t
        ? query({ moderationStatus: status, ...olderThan(cursor, t) })
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
      this.countSubmissions(status),
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
    ].sort(bySubmissionOrder);

    const hasMore = items.length > SUBMISSION_PAGE_SIZE;
    items.length = Math.min(items.length, SUBMISSION_PAGE_SIZE);
    await this.fillCitedSources(items);

    const total = type
      ? countsByType[type]
      : Object.values(countsByType).reduce((sum, n) => sum + n, 0);
    const last = items[items.length - 1];
    return {
      total,
      countsByType,
      items,
      nextCursor: hasMore && last ? submissionCursor(last) : null,
    };
  }

  /** Rows per type in a status — one `count` per table, never the rows. */
  private async countSubmissions(status: ReviewStatus): Promise<Record<ReviewableType, number>> {
    const where = { moderationStatus: status };
    const [company, round, person, investor, acquisition, exit, diversity, proposal] =
      await Promise.all([
        this.prisma.company.count({ where }),
        this.prisma.fundingRound.count({ where }),
        this.prisma.personRole.count({ where }),
        this.prisma.investorHolding.count({ where }),
        this.prisma.acquisitionDeal.count({ where }),
        this.prisma.exitEvent.count({ where }),
        this.prisma.diversitySignal.count({ where }),
        this.prisma.changeProposal.count({ where }),
      ]);
    return { company, round, person, investor, acquisition, exit, diversity, proposal };
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
    try {
      // Read before deciding: the email describes the row, and the prior status
      // is what tells a real decision from a repeat click.
      notice = await loadSubmissionNotice(this.prisma, type, id);
      if (type === 'proposal') {
        if (status === 'APPROVED') {
          await this.applyProposal(id, adminUserId);
        } else {
          await this.prisma.changeProposal.update({
            where: { id },
            data: { moderationStatus: status },
          });
        }
      } else {
        await this.moderateRow(type, id, status, adminUserId);
      }
    } catch {
      throw new NotFoundException(`${type} "${id}" not found`);
    }
    // Only once the decision has committed — and never awaited, so mail being
    // slow or down can't hold up, fail or roll back the moderation.
    if (shouldNotify(notice, status)) this.notifySubmitter(notice, status, note);
    return { id, type, moderationStatus: status };
  }

  /** Email the contributor about a decision. Never throws; failures are logged
      (and reported to GlitchTip by MailService). */
  private notifySubmitter(
    notice: SubmissionNotice & { submitter: NonNullable<SubmissionNotice['submitter']> },
    status: 'APPROVED' | 'REJECTED',
    note: string | null | undefined,
  ): void {
    const { email, name } = notice.submitter;
    const slug = encodeURIComponent(notice.companySlug);
    try {
      const sent =
        status === 'APPROVED'
          ? this.mail.sendSubmissionApprovedEmail(email, name, notice.summary, `/companies/${slug}`)
          : this.mail.sendSubmissionRejectedEmail(
              email,
              name,
              notice.summary,
              note?.trim() || DEFAULT_REJECTION_REASON,
              // A rejected profile has no page; offer the form it came from.
              notice.isCompany ? '/contribute' : `/companies/${slug}/contribute`,
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
      a REJECTED one never was public, so it gets none. */
  private async moderateRow(
    type: RevisableType,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    adminUserId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const published = await applyDecision(tx, type, id, status);
      if (!published) return;
      await tx.revision.create({
        data: createRevision({
          companyId: published.companyId,
          entityType: type,
          entityId: id,
          after: published.after,
          actorUserId: adminUserId,
        }),
      });
    });
  }

  /** Approving a proposal applies its diff to the Company row and flips the
      proposal's status, atomically. Re-approving re-applies the same values
      (and records a second, no-op revision — a faithful record of the action). */
  private async applyProposal(id: string, adminUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.changeProposal.findUniqueOrThrow({
        where: { id },
        include: { company: true },
      });
      const changes = proposal.changes as CompanyEditFields;
      // Captured inside the transaction, before the update — this is the whole
      // point: applying the diff destroys the values it replaces.
      const before = pickCurrent(proposal.company, changes);

      await tx.company.update({
        where: { id: proposal.companyId },
        data: companyDataFromChanges(changes),
      });
      await tx.changeProposal.update({ where: { id }, data: { moderationStatus: 'APPROVED' } });

      const fields = Object.keys(changes) as (keyof CompanyEditFields)[];

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

  /** Fill in the source each contributed row cites, so a moderator can check it
      before approving. One query for the whole queue; proposals already carry
      theirs on the row. */
  private async fillCitedSources(items: PendingSubmission[]): Promise<void> {
    const pending = items.filter((i) => i.sourceUrl === null && i.type !== 'proposal');
    if (pending.length === 0) return;

    const citations = await this.prisma.citation.findMany({
      where: { entityId: { in: pending.map((i) => i.id) }, field: '' },
      select: { entityId: true, source: { select: { url: true } } },
    });
    const byEntity = new Map(citations.map((c) => [c.entityId, c.source.url]));
    for (const item of pending) item.sourceUrl = byEntity.get(item.id) ?? null;
  }

  private item(
    type: ReviewableType,
    row: { id: string; moderationStatus: ReviewStatus; createdAt: Date; submittedBy?: Submitter },
    company: CompanyRef,
    label: string,
    data: unknown,
    sourceUrl: string | null = null,
  ): PendingSubmission {
    return {
      type,
      id: row.id,
      label,
      companySlug: company?.slug ?? null,
      companyName: company?.name ?? null,
      moderationStatus: row.moderationStatus,
      submittedBy: row.submittedBy ?? null,
      createdAt: row.createdAt.toISOString(),
      sourceUrl,
      data,
    };
  }
}
