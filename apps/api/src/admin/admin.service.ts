import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  PendingSubmission,
  PendingSubmissionsResponse,
  ReviewableType,
  ReviewStatus,
} from '@repo/api';

import { PrismaService } from '../prisma/prisma.service';
import {
  toAcquisition,
  toCompany,
  toDiversity,
  toExit,
  toFundingRound,
  toInvestorHolding,
  toPerson,
} from '../companies/company.mapper';

const submittedBy = { select: { id: true, name: true, email: true } } as const;

type Submitter = { id: string; name: string; email: string } | null;
type CompanyRef = { slug: string; name: string } | null;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listSubmissions(status: ReviewStatus): Promise<PendingSubmissionsResponse> {
    const where = { moderationStatus: status };
    const order = { orderBy: { createdAt: 'desc' as const } };

    const [companies, rounds, people, investors, acquisitions, exits, diversity] =
      await Promise.all([
        this.prisma.company.findMany({ where, include: { submittedBy }, ...order }),
        this.prisma.fundingRound.findMany({
          where,
          include: { submittedBy, company: true, investors: true },
          ...order,
        }),
        this.prisma.person.findMany({ where, include: { submittedBy, company: true }, ...order }),
        this.prisma.investorHolding.findMany({
          where,
          include: { submittedBy, company: true },
          ...order,
        }),
        this.prisma.acquisitionDeal.findMany({
          where,
          include: { submittedBy, company: true },
          ...order,
        }),
        this.prisma.exitEvent.findMany({ where, include: { submittedBy, company: true }, ...order }),
        this.prisma.diversitySignal.findMany({
          where,
          include: { submittedBy, company: true },
          ...order,
        }),
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
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      total: items.length,
      countsByType: {
        company: companies.length,
        round: rounds.length,
        person: people.length,
        investor: investors.length,
        acquisition: acquisitions.length,
        exit: exits.length,
        diversity: diversity.length,
      },
      items,
    };
  }

  async moderate(type: ReviewableType, id: string, status: 'APPROVED' | 'REJECTED') {
    try {
      switch (type) {
        case 'company':
          await this.prisma.company.update({ where: { id }, data: { moderationStatus: status } });
          break;
        case 'round':
          await this.prisma.fundingRound.update({
            where: { id },
            data: { moderationStatus: status },
          });
          break;
        case 'person':
          await this.prisma.person.update({ where: { id }, data: { moderationStatus: status } });
          break;
        case 'investor':
          await this.prisma.investorHolding.update({
            where: { id },
            data: { moderationStatus: status },
          });
          break;
        case 'acquisition':
          await this.prisma.acquisitionDeal.update({
            where: { id },
            data: { moderationStatus: status },
          });
          break;
        case 'exit':
          await this.prisma.exitEvent.update({
            where: { id },
            data: { moderationStatus: status },
          });
          break;
        case 'diversity':
          await this.prisma.diversitySignal.update({
            where: { id },
            data: { moderationStatus: status },
          });
          break;
      }
    } catch {
      throw new NotFoundException(`${type} "${id}" not found`);
    }
    return { id, type, moderationStatus: status };
  }

  private item(
    type: ReviewableType,
    row: { id: string; moderationStatus: ReviewStatus; createdAt: Date; submittedBy?: Submitter },
    company: CompanyRef,
    label: string,
    data: unknown,
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
      data,
    };
  }
}
