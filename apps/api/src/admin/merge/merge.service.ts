import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  EntityIdentifierRef,
  IdentifiableType,
  MergeCandidateItem,
  MergeQueueResponse,
  MergeSignal,
  MergeStatus,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import { PrismaService } from '../../prisma/prisma.service';
import { toEntityIdentifiers } from '../../provenance/identifier.mapper';
import { toJsonValue } from '../../provenance/revision.util';

/**
 * What one merge moved, complete enough to reverse it.
 *
 * Two shapes, for two reasons. Ids are enough for a row that was *remapped* —
 * unmerge just points it back. Rows the merge had to **delete** (a unique key
 * the survivor already occupied) need their whole content, because unmerge has
 * to recreate them from nothing.
 */
interface MovedRecord {
  /** child table name → ids whose owning FK was repointed at the survivor. */
  remapped: Record<string, string[]>;
  /** Revision ids whose `companyId` moved (company merges only). */
  revisionCompanyIds: string[];
  /** Revision ids whose `entityId` moved (a company revision anchors to itself). */
  revisionEntityIds: string[];
  /** Citation ids whose `entityId` moved. */
  citationIds: string[];
  /** EntityIdentifier ids whose `entityId` moved. */
  identifierIds: string[];
  /** Deleted because the survivor already held the same (userId, companyId). */
  deletedSavedCompanies: { userId: string; createdAt: string }[];
  /** Deleted on the (sourceId, entityType, entityId, field) unique key. */
  deletedCitations: {
    sourceId: string;
    entityType: string;
    field: string;
    note: string | null;
    submittedById: string | null;
    createdAt: string;
  }[];
  /** Deleted on the (scheme, value, entityType) unique key — usually the very
   *  identifier that proposed the pair. */
  deletedIdentifiers: { scheme: string; value: string; source: string; createdAt: string }[];
}

function emptyMoved(): MovedRecord {
  return {
    remapped: {},
    revisionCompanyIds: [],
    revisionEntityIds: [],
    citationIds: [],
    identifierIds: [],
    deletedSavedCompanies: [],
    deletedCitations: [],
    deletedIdentifiers: [],
  };
}

/** Child tables whose rows hang off a company by `companyId`. None of these can
 *  violate a unique key on a remap: their `@@unique([externalSource, externalId])`
 *  is global across the table, not per company, so a pair that would collide is
 *  already one row. */
const COMPANY_CHILDREN = [
  'fundingRound',
  'person',
  'investorHolding',
  'acquisitionDeal',
  'exitEvent',
  'diversitySignal',
  'changeProposal',
] as const;

type CompanyChild = (typeof COMPANY_CHILDREN)[number];

/** Investor-owned FKs. Each is nullable or required on a different table, so
 *  they are listed with the column that points at the firm. */
const INVESTOR_CHILDREN = [
  { model: 'investorHolding', column: 'investorId' },
  { model: 'roundInvestor', column: 'investorId' },
  { model: 'fund', column: 'managerId' },
] as const;

@Injectable()
export class MergeService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Queue ---------------------------------------------------------------

  /** The review queue: candidate pairs with both sides rendered enough to
   *  decide on, strongest signal first. */
  async listCandidates(
    status: MergeStatus = 'PENDING',
    entityType?: IdentifiableType,
  ): Promise<MergeQueueResponse> {
    const where = { status, ...(entityType ? { entityType } : {}) };
    const rows = await this.prisma.mergeCandidate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Signal order, not insertion order: an identifier collision is the
    // publisher's own statement and deserves the top of the queue.
    const rank: Record<MergeSignal, number> = { identifier: 0, domain: 1, name: 2 };
    rows.sort(
      (a, b) =>
        (rank[a.signal as MergeSignal] ?? 9) - (rank[b.signal as MergeSignal] ?? 9) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );

    const countsBySignal: Record<MergeSignal, number> = { identifier: 0, domain: 0, name: 0 };
    for (const r of await this.prisma.mergeCandidate.groupBy({
      by: ['signal'],
      where,
      _count: { _all: true },
    })) {
      countsBySignal[r.signal as MergeSignal] = r._count._all;
    }

    const items: MergeCandidateItem[] = [];
    for (const row of rows) {
      const type = row.entityType as IdentifiableType;
      const [left, right] = await Promise.all([
        this.side(type, row.leftId),
        this.side(type, row.rightId),
      ]);
      // A side can be missing if the row was deleted out from under the queue.
      if (!left || !right) continue;

      const record =
        row.status === 'MERGED'
          ? await this.prisma.mergeRecord.findFirst({
              where: { candidateId: row.id, unmergedAt: null },
              select: { id: true },
            })
          : null;

      items.push({
        id: row.id,
        entityType: type,
        signal: row.signal as MergeSignal,
        evidence: row.evidence,
        status: row.status as MergeStatus,
        createdAt: row.createdAt.toISOString(),
        left,
        right,
        mergeRecordId: record?.id ?? null,
      });
    }

    return { total: items.length, countsBySignal, items };
  }

  /** One side of a candidate: identity, the fields a reviewer diffs, its
   *  identifiers, and the child counts that usually decide which row wins. */
  private async side(entityType: IdentifiableType, id: string) {
    const identifiers = await this.identifiersFor(entityType, id);

    if (entityType === 'company') {
      const row = await this.prisma.company.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              rounds: true,
              people: true,
              investors: true,
              acquisitions: true,
              exits: true,
              diversity: true,
            },
          },
        },
      });
      if (!row) return null;
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        domain: row.domain || null,
        hq: row.hq || null,
        externalSource: row.externalSource,
        externalId: row.externalId,
        createdAt: row.createdAt.toISOString(),
        identifiers,
        counts: { ...row._count },
      };
    }

    const row = await this.prisma.investor.findUnique({
      where: { id },
      include: { _count: { select: { holdings: true, funds: true, roundPositions: true } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      domain: row.domain,
      hq: row.hq,
      externalSource: row.externalSource,
      externalId: row.externalId,
      createdAt: row.createdAt.toISOString(),
      identifiers,
      counts: { ...row._count },
    };
  }

  private async identifiersFor(
    entityType: IdentifiableType,
    entityId: string,
  ): Promise<EntityIdentifierRef[]> {
    const rows = await this.prisma.entityIdentifier.findMany({ where: { entityType, entityId } });
    return toEntityIdentifiers(rows);
  }

  /** Queue a pair the detector missed. Ids are ordered canonically so it lands
   *  on the same row the detector would have written. */
  async createCandidate(
    entityType: IdentifiableType,
    aId: string,
    bId: string,
  ): Promise<MergeCandidateItem> {
    if (aId === bId) throw new BadRequestException('A row cannot be merged with itself');
    const [leftId, rightId] = aId < bId ? [aId, bId] : [bId, aId];

    const [left, right] = await Promise.all([
      this.side(entityType, leftId),
      this.side(entityType, rightId),
    ]);
    if (!left || !right) throw new NotFoundException('One of the rows does not exist');

    const row = await this.prisma.mergeCandidate.upsert({
      where: { entityType_leftId_rightId: { entityType, leftId, rightId } },
      create: { entityType, leftId, rightId, signal: 'name', evidence: 'queued by an admin' },
      update: {},
    });

    return {
      id: row.id,
      entityType,
      signal: row.signal as MergeSignal,
      evidence: row.evidence,
      status: row.status as MergeStatus,
      createdAt: row.createdAt.toISOString(),
      left,
      right,
      mergeRecordId: null,
    };
  }

  /** Mark a pair "not a duplicate". The row is kept, not deleted, so no
   *  detector ever proposes it again. */
  async reject(candidateId: string, adminUserId: string): Promise<{ id: string; status: MergeStatus }> {
    const row = await this.prisma.mergeCandidate.findUnique({ where: { id: candidateId } });
    if (!row) throw new NotFoundException(`Merge candidate "${candidateId}" not found`);
    if (row.status === 'MERGED') {
      throw new BadRequestException('This pair was merged; unmerge it before rejecting');
    }
    await this.prisma.mergeCandidate.update({
      where: { id: candidateId },
      data: { status: 'REJECTED', decidedAt: new Date(), decidedById: adminUserId },
    });
    return { id: candidateId, status: 'REJECTED' };
  }

  // --- Merge ---------------------------------------------------------------

  /**
   * Fold one row into another, in a single transaction.
   *
   * The loser is **tombstoned, never deleted**. Deleting it would free its
   * `(externalSource, externalId)` pair, and the next ingest run's `byKey`
   * lookup would miss and recreate the duplicate — the merge would silently
   * undo itself. Keeping the row is also what makes the slug redirect and the
   * unmerge possible.
   */
  async mergeCandidate(
    candidateId: string,
    survivorId: string,
    adminUserId: string,
  ): Promise<{ mergeRecordId: string; survivorId: string; losingId: string }> {
    const candidate = await this.prisma.mergeCandidate.findUnique({ where: { id: candidateId } });
    if (!candidate) throw new NotFoundException(`Merge candidate "${candidateId}" not found`);
    if (candidate.status !== 'PENDING') {
      throw new BadRequestException(`Candidate is already ${candidate.status}`);
    }
    if (survivorId !== candidate.leftId && survivorId !== candidate.rightId) {
      throw new BadRequestException('The survivor must be one of the pair');
    }
    const losingId = survivorId === candidate.leftId ? candidate.rightId : candidate.leftId;

    return this.merge(
      candidate.entityType as IdentifiableType,
      survivorId,
      losingId,
      adminUserId,
      candidateId,
    );
  }

  async merge(
    entityType: IdentifiableType,
    survivorId: string,
    losingId: string,
    adminUserId: string,
    candidateId?: string,
  ): Promise<{ mergeRecordId: string; survivorId: string; losingId: string }> {
    if (survivorId === losingId) throw new BadRequestException('A row cannot be merged into itself');

    return this.prisma.$transaction(async (tx) => {
      const moved =
        entityType === 'company'
          ? await this.mergeCompany(tx, survivorId, losingId, adminUserId)
          : await this.mergeInvestor(tx, survivorId, losingId);

      const record = await tx.mergeRecord.create({
        data: {
          entityType,
          survivorId,
          losingId,
          moved: moved as unknown as Prisma.InputJsonValue,
          candidateId: candidateId ?? null,
          mergedById: adminUserId,
        },
        select: { id: true },
      });

      if (candidateId) {
        await tx.mergeCandidate.update({
          where: { id: candidateId },
          data: { status: 'MERGED', decidedAt: new Date(), decidedById: adminUserId },
        });
      }

      return { mergeRecordId: record.id, survivorId, losingId };
    });
  }

  private async mergeCompany(
    tx: Prisma.TransactionClient,
    survivorId: string,
    losingId: string,
    adminUserId: string,
  ): Promise<MovedRecord> {
    const [survivor, loser] = await Promise.all([
      tx.company.findUnique({ where: { id: survivorId } }),
      tx.company.findUnique({ where: { id: losingId } }),
    ]);
    if (!survivor || !loser) throw new NotFoundException('One of the companies does not exist');
    if (survivor.mergedIntoId || loser.mergedIntoId) {
      throw new BadRequestException('One of the rows has already been merged away');
    }

    const moved = emptyMoved();

    for (const model of COMPANY_CHILDREN) {
      moved.remapped[model] = await remapByCompany(tx, model, losingId, survivorId);
    }

    // SavedCompany is the one child that CAN collide: @@unique([userId, companyId]).
    // A user who saved both rows would end up with two rows for one company.
    const [loserSaves, survivorSaves] = await Promise.all([
      tx.savedCompany.findMany({ where: { companyId: losingId } }),
      tx.savedCompany.findMany({ where: { companyId: survivorId }, select: { userId: true } }),
    ]);
    const alreadySaved = new Set(survivorSaves.map((s) => s.userId));
    const remapSaves: string[] = [];
    for (const save of loserSaves) {
      if (alreadySaved.has(save.userId)) {
        moved.deletedSavedCompanies.push({
          userId: save.userId,
          createdAt: save.createdAt.toISOString(),
        });
        await tx.savedCompany.delete({ where: { id: save.id } });
      } else {
        remapSaves.push(save.id);
      }
    }
    if (remapSaves.length > 0) {
      await tx.savedCompany.updateMany({
        where: { id: { in: remapSaves } },
        data: { companyId: survivorId },
      });
    }
    moved.remapped.savedCompany = remapSaves;

    // Revisions anchor to a company, and a *company* revision also anchors to
    // itself (entityId === companyId), so both columns move.
    moved.revisionCompanyIds = (
      await tx.revision.findMany({ where: { companyId: losingId }, select: { id: true } })
    ).map((r) => r.id);
    moved.revisionEntityIds = (
      await tx.revision.findMany({
        where: { entityType: 'company', entityId: losingId },
        select: { id: true },
      })
    ).map((r) => r.id);
    await tx.revision.updateMany({ where: { companyId: losingId }, data: { companyId: survivorId } });
    await tx.revision.updateMany({
      where: { entityType: 'company', entityId: losingId },
      data: { entityId: survivorId },
    });

    await this.moveCitations(tx, 'company', survivorId, losingId, moved);
    await this.moveIdentifiers(tx, 'company', survivorId, losingId, moved);

    await tx.company.update({ where: { id: losingId }, data: { mergedIntoId: survivorId } });

    // One whole-row entry on the survivor's public timeline. No field diff: a
    // merge is not a column changing value.
    await tx.revision.create({
      data: {
        companyId: survivorId,
        entityType: 'company',
        entityId: survivorId,
        field: '',
        before: toJsonValue({ slug: loser.slug, name: loser.name }),
        after: toJsonValue({ slug: survivor.slug, name: survivor.name }),
        action: 'MERGE',
        actor: 'ADMIN',
        actorUserId: adminUserId,
      },
    });

    return moved;
  }

  private async mergeInvestor(
    tx: Prisma.TransactionClient,
    survivorId: string,
    losingId: string,
  ): Promise<MovedRecord> {
    const [survivor, loser] = await Promise.all([
      tx.investor.findUnique({ where: { id: survivorId } }),
      tx.investor.findUnique({ where: { id: losingId } }),
    ]);
    if (!survivor || !loser) throw new NotFoundException('One of the investors does not exist');
    if (survivor.mergedIntoId || loser.mergedIntoId) {
      throw new BadRequestException('One of the rows has already been merged away');
    }

    const moved = emptyMoved();

    for (const { model, column } of INVESTOR_CHILDREN) {
      moved.remapped[model] = await remapByColumn(tx, model, column, losingId, survivorId);
    }

    // InvestorHolding rows that become duplicates for the same (company, firm)
    // pair are LEFT ALONE: no unique constraint is violated, two sources can
    // already produce two rows today, and collapsing them would make the merge
    // irreversible.

    await this.moveCitations(tx, 'investor', survivorId, losingId, moved);
    await this.moveIdentifiers(tx, 'investor', survivorId, losingId, moved);

    // No Revision is written. `Revision.companyId` is required and a firm has
    // no company — the same reason Fund writes none. The MergeRecord is the
    // audit trail here.

    await tx.investor.update({ where: { id: losingId }, data: { mergedIntoId: survivorId } });
    return moved;
  }

  /**
   * Repoint the loser's own citations at the survivor.
   *
   * Filtering on `entityId` is what makes this correct despite `entityType:
   * 'investor'` being overloaded — the citation backfill writes it for an
   * Investor *firm*, while moderation writes it for an InvestorHolding. Only
   * rows whose entityId IS the losing row match, and holdings keep their own
   * ids through a merge.
   */
  private async moveCitations(
    tx: Prisma.TransactionClient,
    entityType: IdentifiableType,
    survivorId: string,
    losingId: string,
    moved: MovedRecord,
  ): Promise<void> {
    const [mine, theirs] = await Promise.all([
      tx.citation.findMany({ where: { entityType, entityId: losingId } }),
      tx.citation.findMany({
        where: { entityType, entityId: survivorId },
        select: { sourceId: true, field: true },
      }),
    ]);
    // @@unique([sourceId, entityType, entityId, field]) — both rows citing the
    // same source for the same field would collide on the remap.
    const taken = new Set(theirs.map((c) => `${c.sourceId}:${c.field}`));

    const remap: string[] = [];
    for (const c of mine) {
      if (taken.has(`${c.sourceId}:${c.field}`)) {
        moved.deletedCitations.push({
          sourceId: c.sourceId,
          entityType: c.entityType,
          field: c.field,
          note: c.note,
          submittedById: c.submittedById,
          createdAt: c.createdAt.toISOString(),
        });
        await tx.citation.delete({ where: { id: c.id } });
      } else {
        remap.push(c.id);
      }
    }
    if (remap.length > 0) {
      await tx.citation.updateMany({ where: { id: { in: remap } }, data: { entityId: survivorId } });
    }
    moved.citationIds = remap;
  }

  /** Move the identifiers the survivor lacks; delete the ones it already holds
   *  — usually the very identifier that proposed the pair. */
  private async moveIdentifiers(
    tx: Prisma.TransactionClient,
    entityType: IdentifiableType,
    survivorId: string,
    losingId: string,
    moved: MovedRecord,
  ): Promise<void> {
    const [mine, theirs] = await Promise.all([
      tx.entityIdentifier.findMany({ where: { entityType, entityId: losingId } }),
      tx.entityIdentifier.findMany({
        where: { entityType, entityId: survivorId },
        select: { scheme: true, value: true },
      }),
    ]);
    const taken = new Set(theirs.map((i) => `${i.scheme}:${i.value}`));

    const remap: string[] = [];
    for (const i of mine) {
      if (taken.has(`${i.scheme}:${i.value}`)) {
        moved.deletedIdentifiers.push({
          scheme: i.scheme,
          value: i.value,
          source: i.source,
          createdAt: i.createdAt.toISOString(),
        });
        await tx.entityIdentifier.delete({ where: { id: i.id } });
      } else {
        remap.push(i.id);
      }
    }
    if (remap.length > 0) {
      await tx.entityIdentifier.updateMany({
        where: { id: { in: remap } },
        data: { entityId: survivorId },
      });
    }
    moved.identifierIds = remap;
  }

  // --- Unmerge -------------------------------------------------------------

  /**
   * Reverse a merge: replay `moved` backwards in one transaction.
   *
   * Remapped rows are pointed back at the loser; deleted rows are recreated
   * from the content the merge recorded, which is why `moved` stores more than
   * ids for those. The MergeRecord is kept either way — it is the audit trail
   * for both directions.
   */
  async unmerge(
    recordId: string,
    adminUserId: string,
  ): Promise<{ mergeRecordId: string; survivorId: string; losingId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.mergeRecord.findUnique({ where: { id: recordId } });
      if (!record) throw new NotFoundException(`Merge record "${recordId}" not found`);
      if (record.unmergedAt) throw new BadRequestException('This merge has already been reversed');

      const entityType = record.entityType as IdentifiableType;
      const { survivorId, losingId } = record;
      const moved = record.moved as unknown as MovedRecord;

      if (entityType === 'company') {
        await this.unmergeCompany(tx, survivorId, losingId, moved, adminUserId);
      } else {
        await this.unmergeInvestor(tx, survivorId, losingId, moved);
      }

      await tx.mergeRecord.update({
        where: { id: recordId },
        data: { unmergedAt: new Date(), unmergedById: adminUserId },
      });
      if (record.candidateId) {
        await tx.mergeCandidate.update({
          where: { id: record.candidateId },
          data: { status: 'PENDING', decidedAt: null, decidedById: null },
        });
      }

      return { mergeRecordId: recordId, survivorId, losingId };
    });
  }

  private async unmergeCompany(
    tx: Prisma.TransactionClient,
    survivorId: string,
    losingId: string,
    moved: MovedRecord,
    adminUserId: string,
  ): Promise<void> {
    const [survivor, loser] = await Promise.all([
      tx.company.findUnique({ where: { id: survivorId } }),
      tx.company.findUnique({ where: { id: losingId } }),
    ]);
    if (!survivor || !loser) throw new NotFoundException('One of the companies no longer exists');
    // The state this would restore no longer exists: the survivor has itself
    // been folded into something else since.
    if (survivor.mergedIntoId) {
      throw new BadRequestException('The survivor has since been merged away; unmerge that first');
    }
    if (loser.mergedIntoId !== survivorId) {
      throw new BadRequestException('This row is no longer merged into that survivor');
    }

    for (const model of COMPANY_CHILDREN) {
      await restoreByCompany(tx, model, moved.remapped[model] ?? [], losingId);
    }

    const saveIds = moved.remapped.savedCompany ?? [];
    if (saveIds.length > 0) {
      await tx.savedCompany.updateMany({
        where: { id: { in: saveIds } },
        data: { companyId: losingId },
      });
    }
    for (const s of moved.deletedSavedCompanies) {
      await tx.savedCompany.create({
        data: { userId: s.userId, companyId: losingId, createdAt: new Date(s.createdAt) },
      });
    }

    if (moved.revisionCompanyIds.length > 0) {
      await tx.revision.updateMany({
        where: { id: { in: moved.revisionCompanyIds } },
        data: { companyId: losingId },
      });
    }
    if (moved.revisionEntityIds.length > 0) {
      await tx.revision.updateMany({
        where: { id: { in: moved.revisionEntityIds } },
        data: { entityId: losingId },
      });
    }

    await this.restoreCitations(tx, losingId, moved);
    await this.restoreIdentifiers(tx, 'company', losingId, moved);

    await tx.company.update({ where: { id: losingId }, data: { mergedIntoId: null } });

    await tx.revision.create({
      data: {
        companyId: survivorId,
        entityType: 'company',
        entityId: survivorId,
        field: '',
        before: toJsonValue({ slug: survivor.slug, name: survivor.name }),
        after: toJsonValue({ slug: loser.slug, name: loser.name }),
        action: 'UNMERGE',
        actor: 'ADMIN',
        actorUserId: adminUserId,
      },
    });
  }

  private async unmergeInvestor(
    tx: Prisma.TransactionClient,
    survivorId: string,
    losingId: string,
    moved: MovedRecord,
  ): Promise<void> {
    const [survivor, loser] = await Promise.all([
      tx.investor.findUnique({ where: { id: survivorId } }),
      tx.investor.findUnique({ where: { id: losingId } }),
    ]);
    if (!survivor || !loser) throw new NotFoundException('One of the investors no longer exists');
    if (survivor.mergedIntoId) {
      throw new BadRequestException('The survivor has since been merged away; unmerge that first');
    }
    if (loser.mergedIntoId !== survivorId) {
      throw new BadRequestException('This row is no longer merged into that survivor');
    }

    for (const { model, column } of INVESTOR_CHILDREN) {
      await restoreByColumn(tx, model, column, moved.remapped[model] ?? [], losingId);
    }

    await this.restoreCitations(tx, losingId, moved);
    await this.restoreIdentifiers(tx, 'investor', losingId, moved);

    await tx.investor.update({ where: { id: losingId }, data: { mergedIntoId: null } });
  }

  /** No entityType parameter: each deleted citation recorded its own, which is
   *  the value that must come back. */
  private async restoreCitations(
    tx: Prisma.TransactionClient,
    losingId: string,
    moved: MovedRecord,
  ): Promise<void> {
    if (moved.citationIds.length > 0) {
      await tx.citation.updateMany({
        where: { id: { in: moved.citationIds } },
        data: { entityId: losingId },
      });
    }
    for (const c of moved.deletedCitations) {
      await tx.citation.create({
        data: {
          sourceId: c.sourceId,
          entityType: c.entityType,
          entityId: losingId,
          field: c.field,
          note: c.note,
          submittedById: c.submittedById,
          createdAt: new Date(c.createdAt),
        },
      });
    }
  }

  private async restoreIdentifiers(
    tx: Prisma.TransactionClient,
    entityType: IdentifiableType,
    losingId: string,
    moved: MovedRecord,
  ): Promise<void> {
    if (moved.identifierIds.length > 0) {
      await tx.entityIdentifier.updateMany({
        where: { id: { in: moved.identifierIds } },
        data: { entityId: losingId },
      });
    }
    for (const i of moved.deletedIdentifiers) {
      await tx.entityIdentifier.create({
        data: {
          scheme: i.scheme,
          value: i.value,
          entityType,
          entityId: losingId,
          source: i.source,
          createdAt: new Date(i.createdAt),
        },
      });
    }
  }
}

/** Capture then repoint a company's children. The ids are captured first so an
 *  unmerge can move exactly these rows back — and only these. */
async function remapByCompany(
  tx: Prisma.TransactionClient,
  model: CompanyChild,
  losingId: string,
  survivorId: string,
): Promise<string[]> {
  const delegate = tx[model] as unknown as {
    findMany(args: unknown): Promise<{ id: string }[]>;
    updateMany(args: unknown): Promise<unknown>;
  };
  const rows = await delegate.findMany({ where: { companyId: losingId }, select: { id: true } });
  if (rows.length === 0) return [];
  await delegate.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { companyId: survivorId },
  });
  return rows.map((r) => r.id);
}

async function restoreByCompany(
  tx: Prisma.TransactionClient,
  model: CompanyChild,
  ids: string[],
  losingId: string,
): Promise<void> {
  if (ids.length === 0) return;
  const delegate = tx[model] as unknown as { updateMany(args: unknown): Promise<unknown> };
  await delegate.updateMany({ where: { id: { in: ids } }, data: { companyId: losingId } });
}

async function remapByColumn(
  tx: Prisma.TransactionClient,
  model: (typeof INVESTOR_CHILDREN)[number]['model'],
  column: string,
  losingId: string,
  survivorId: string,
): Promise<string[]> {
  const delegate = tx[model] as unknown as {
    findMany(args: unknown): Promise<{ id: string }[]>;
    updateMany(args: unknown): Promise<unknown>;
  };
  const rows = await delegate.findMany({ where: { [column]: losingId }, select: { id: true } });
  if (rows.length === 0) return [];
  await delegate.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { [column]: survivorId },
  });
  return rows.map((r) => r.id);
}

async function restoreByColumn(
  tx: Prisma.TransactionClient,
  model: (typeof INVESTOR_CHILDREN)[number]['model'],
  column: string,
  ids: string[],
  losingId: string,
): Promise<void> {
  if (ids.length === 0) return;
  const delegate = tx[model] as unknown as { updateMany(args: unknown): Promise<unknown> };
  await delegate.updateMany({ where: { id: { in: ids } }, data: { [column]: losingId } });
}
