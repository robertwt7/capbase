import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ReportableType,
  ReportItem,
  ReportQueueResponse,
  ReportReason,
  ReportStatus,
} from '@repo/api';

import { PrismaService } from '../prisma/prisma.service';
import {
  PUBLIC_COMPANY,
  PUBLIC_INVESTOR,
  PUBLIC_PERSON,
} from '../prisma/public-filters';
import type {
  CreateReportDto,
  DismissReportDto,
  ResolveReportDto,
} from './dto/report.dto';

/** The admin list is a work queue, not an archive browser. */
const QUEUE_LIMIT = 200;

type ReportedEntity = NonNullable<ReportItem['entity']>;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * File a visitor's report. The slug is resolved through the PUBLIC filter for
   * its type: you can only report what the public can see, and a tombstoned
   * slug is not followed to its survivor. Returns the id only — nothing about
   * the queue leaks to an anonymous caller.
   */
  async create(dto: CreateReportDto): Promise<{ id: string }> {
    const entityId = await this.resolvePublicId(dto.entityType, dto.slug);
    if (!entityId) throw new NotFoundException('Profile not found');

    const row = await this.prisma.report.create({
      data: {
        entityType: dto.entityType,
        entityId,
        reason: dto.reason,
        message: dto.message.trim(),
        email: dto.email ? dto.email.trim().toLowerCase() : null,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async list(status: ReportStatus = 'OPEN'): Promise<ReportQueueResponse> {
    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({
        where: { status },
        orderBy: { createdAt: 'desc' },
        take: QUEUE_LIMIT,
        include: { resolvedBy: { select: { email: true } } },
      }),
      this.prisma.report.count({ where: { status } }),
    ]);

    const entities = await this.resolveEntities(
      rows.map((r) => ({
        type: r.entityType as ReportableType,
        id: r.entityId,
      })),
    );

    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        entityType: r.entityType as ReportableType,
        entityId: r.entityId,
        entity: entities.get(`${r.entityType}:${r.entityId}`) ?? null,
        reason: r.reason as ReportReason,
        message: r.message,
        email: r.email,
        status: r.status as ReportStatus,
        resolutionNote: r.resolutionNote,
        resolutionUrl: r.resolutionUrl,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolvedBy: r.resolvedBy?.email ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Closing an already-closed report is allowed: it overwrites the note, so an
   *  admin can correct one. There is no state machine beyond that. */
  async dismiss(
    id: string,
    dto: DismissReportDto,
    adminId: string,
  ): Promise<{ id: string }> {
    await this.requireReport(id);
    await this.prisma.report.update({
      where: { id },
      data: {
        status: 'DISMISSED',
        resolutionNote: blankToNull(dto.note),
        resolutionUrl: null,
        resolvedAt: new Date(),
        resolvedById: adminId,
      },
    });
    return { id };
  }

  /**
   * Resolve a report: bookkeeping (note + optional link) and nothing else —
   * unless it is a person report and the admin chose `suppressPerson`, in which
   * case the person is hidden in the same transaction (the same write as
   * `PeopleService.setSuppressed`), so the report never reads RESOLVED while
   * the profile is still up.
   */
  async resolve(
    id: string,
    dto: ResolveReportDto,
    adminId: string,
  ): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.findUnique({
        where: { id },
        select: { id: true, entityType: true, entityId: true },
      });
      if (!report) throw new NotFoundException('Report not found');

      if (dto.suppressPerson) {
        if (report.entityType !== 'person') {
          throw new BadRequestException(
            'Only a person report can suppress its subject',
          );
        }
        await tx.person.update({
          where: { id: report.entityId },
          data: { suppressedAt: new Date() },
        });
      }

      await tx.report.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolutionNote: blankToNull(dto.note),
          resolutionUrl: blankToNull(dto.url),
          resolvedAt: new Date(),
          resolvedById: adminId,
        },
      });
      return { id };
    });
  }

  private async requireReport(id: string): Promise<void> {
    const row = await this.prisma.report.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Report not found');
  }

  private async resolvePublicId(
    type: ReportableType,
    slug: string,
  ): Promise<string | null> {
    const select = { id: true } as const;
    switch (type) {
      case 'company':
        return (
          (
            await this.prisma.company.findFirst({
              where: { slug, ...PUBLIC_COMPANY },
              select,
            })
          )?.id ?? null
        );
      case 'investor':
        return (
          (
            await this.prisma.investor.findFirst({
              where: { slug, ...PUBLIC_INVESTOR },
              select,
            })
          )?.id ?? null
        );
      case 'person':
        return (
          (
            await this.prisma.person.findFirst({
              where: { slug, ...PUBLIC_PERSON },
              select,
            })
          )?.id ?? null
        );
    }
  }

  /**
   * Name and slug for each reported row, one query per type. Deliberately NO
   * public filter: the admin must still see a target that has since been
   * suppressed or merged away.
   */
  private async resolveEntities(
    refs: { type: ReportableType; id: string }[],
  ): Promise<Map<string, ReportedEntity>> {
    const ids = (type: ReportableType) => [
      ...new Set(refs.filter((r) => r.type === type).map((r) => r.id)),
    ];
    const select = { id: true, name: true, slug: true } as const;
    const [companies, investors, people] = await Promise.all([
      ids('company').length
        ? this.prisma.company.findMany({
            where: { id: { in: ids('company') } },
            select,
          })
        : [],
      ids('investor').length
        ? this.prisma.investor.findMany({
            where: { id: { in: ids('investor') } },
            select,
          })
        : [],
      ids('person').length
        ? this.prisma.person.findMany({
            where: { id: { in: ids('person') } },
            select: { ...select, suppressedAt: true },
          })
        : [],
    ]);

    const out = new Map<string, ReportedEntity>();
    for (const c of companies)
      out.set(`company:${c.id}`, {
        name: c.name,
        slug: c.slug,
        suppressed: false,
      });
    for (const i of investors)
      out.set(`investor:${i.id}`, {
        name: i.name,
        slug: i.slug,
        suppressed: false,
      });
    for (const p of people) {
      out.set(`person:${p.id}`, {
        name: p.name,
        slug: p.slug,
        suppressed: p.suppressedAt !== null,
      });
    }
    return out;
  }
}

function blankToNull(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}
