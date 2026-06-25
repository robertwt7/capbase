import { Injectable } from '@nestjs/common';
import {
  CONTRIBUTION_WINDOW_DAYS,
  type MyContribution,
  type ReviewableType,
  type ReviewStatus,
  type Role,
} from '@repo/api';

import { PrismaService } from '../prisma/prisma.service';

const WINDOW_MS = CONTRIBUTION_WINDOW_DAYS * 86_400_000;

// Company belongs to itself; sub-entities carry a `company` relation.
type CompanyRef = { slug: string; name: string } | null;
type ContributionRow = {
  id: string;
  moderationStatus: ReviewStatus;
  createdAt: Date;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: { email: string; name: string; passwordHash: string; role?: Role }) {
    return this.prisma.user.create({ data });
  }

  /** Most recent contribution timestamp across all contributable models, or null. */
  async lastContributionAt(userId: string): Promise<Date | null> {
    const opts = {
      where: { submittedById: userId },
      orderBy: { createdAt: 'desc' as const },
      select: { createdAt: true },
    };
    const rows = await Promise.all([
      this.prisma.company.findFirst(opts),
      this.prisma.fundingRound.findFirst(opts),
      this.prisma.person.findFirst(opts),
      this.prisma.investorHolding.findFirst(opts),
      this.prisma.acquisitionDeal.findFirst(opts),
      this.prisma.exitEvent.findFirst(opts),
      this.prisma.diversitySignal.findFirst(opts),
    ]);
    const dates = rows
      .map((r) => r?.createdAt)
      .filter((d): d is Date => d instanceof Date);
    if (dates.length === 0) return null;
    return dates.reduce((a, b) => (a > b ? a : b));
  }

  /** True if the user has submitted any contribution at/after `since`. */
  async hasRecentContribution(userId: string, since: Date): Promise<boolean> {
    const last = await this.lastContributionAt(userId);
    return last !== null && last >= since;
  }

  /** Date full access lapses (last contribution + window), or null if none. */
  async unlockedUntil(userId: string): Promise<Date | null> {
    const last = await this.lastContributionAt(userId);
    return last ? new Date(last.getTime() + WINDOW_MS) : null;
  }

  /** A user's own submissions across every type, any status, newest first. */
  async listContributions(userId: string): Promise<MyContribution[]> {
    const where = { submittedById: userId };
    const order = { orderBy: { createdAt: 'desc' as const } };
    const withCompany = { include: { company: { select: { slug: true, name: true } } }, ...order };

    const [companies, rounds, people, investors, acquisitions, exits, diversity] =
      await Promise.all([
        this.prisma.company.findMany({ where, ...order }),
        this.prisma.fundingRound.findMany({ where, ...withCompany }),
        this.prisma.person.findMany({ where, ...withCompany }),
        this.prisma.investorHolding.findMany({ where, ...withCompany }),
        this.prisma.acquisitionDeal.findMany({ where, ...withCompany }),
        this.prisma.exitEvent.findMany({ where, ...withCompany }),
        this.prisma.diversitySignal.findMany({ where, ...withCompany }),
      ]);

    const items: MyContribution[] = [
      ...companies.map((c) => this.toItem('company', c, { slug: c.slug, name: c.name }, c.name)),
      ...rounds.map((r) => this.toItem('round', r, r.company, `${r.name} round`)),
      ...people.map((p) => this.toItem('person', p, p.company, p.name)),
      ...investors.map((i) => this.toItem('investor', i, i.company, i.name)),
      ...acquisitions.map((a) => this.toItem('acquisition', a, a.company, `Acquired ${a.target}`)),
      ...exits.map((e) => this.toItem('exit', e, e.company, `${e.type} exit`)),
      ...diversity.map((d) => this.toItem('diversity', d, d.company, d.label)),
    ];
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private toItem(
    type: ReviewableType,
    row: ContributionRow,
    company: CompanyRef,
    label: string,
  ): MyContribution {
    return {
      type,
      id: row.id,
      label,
      companySlug: company?.slug ?? null,
      companyName: company?.name ?? null,
      moderationStatus: row.moderationStatus,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
