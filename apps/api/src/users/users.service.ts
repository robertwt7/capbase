import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CONTRIBUTION_WINDOW_DAYS,
  type MyContribution,
  type ReviewableType,
  type ReviewStatus,
  type Role,
  type SavedCompanyItem,
  type SavedStatus,
} from '@repo/api';

import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_COMPANY, PUBLIC_COMPANY_RELATION } from '../prisma/public-filters';

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

  update(id: string, data: { name?: string; email?: string; passwordHash?: string }) {
    return this.prisma.user.update({ where: { id }, data });
  }

  /** Set a new password and revoke every session minted before it. */
  setPassword(id: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
  }

  /** When this user's newest reset link was issued, or null. */
  async lastResetRequestAt(userId: string): Promise<Date | null> {
    const row = await this.prisma.passwordResetToken.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  /** Issue a reset link, retiring any older unused one so only the newest works. */
  async createResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({
        where: { userId, usedAt: null },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId, tokenHash, expiresAt },
      }),
    ]);
  }

  /**
   * Spend a reset token: set the password, revoke sessions, mark the token used.
   * Returns false when the token is unknown, used, expired, or its user banned.
   */
  async consumeResetToken(tokenHash: string, passwordHash: string): Promise<boolean> {
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { bannedAt: true } } },
    });
    if (!token || token.usedAt || token.expiresAt < new Date() || token.user.bannedAt) {
      return false;
    }
    // The conditional updateMany is the guard against a double-submit race:
    // only one request can flip usedAt from null.
    return this.prisma.$transaction(async (tx) => {
      const spent = await tx.passwordResetToken.updateMany({
        where: { id: token.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (spent.count === 0) return false;
      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      return true;
    });
  }

  /** The user's saved companies (approved only), newest first. */
  async listSavedCompanies(userId: string): Promise<SavedCompanyItem[]> {
    const rows = await this.prisma.savedCompany.findMany({
      where: { userId, company: PUBLIC_COMPANY_RELATION },
      include: {
        company: {
          select: {
            slug: true,
            name: true,
            domain: true,
            oneLiner: true,
            stage: true,
            totalRaisedUsd: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      slug: r.company.slug,
      name: r.company.name,
      domain: r.company.domain,
      oneLiner: r.company.oneLiner,
      stage: r.company.stage as SavedCompanyItem['stage'],
      totalRaisedUsd: Number(r.company.totalRaisedUsd),
      savedAt: r.createdAt.toISOString(),
    }));
  }

  /** Idempotently save an approved company by slug. */
  async saveCompany(userId: string, slug: string): Promise<SavedStatus> {
    const company = await this.prisma.company.findFirst({
      where: { slug, ...PUBLIC_COMPANY },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    await this.prisma.savedCompany.upsert({
      where: { userId_companyId: { userId, companyId: company.id } },
      create: { userId, companyId: company.id },
      update: {},
    });
    return { saved: true };
  }

  /** Idempotently remove a saved company by slug. */
  async unsaveCompany(userId: string, slug: string): Promise<SavedStatus> {
    await this.prisma.savedCompany.deleteMany({
      where: { userId, company: { slug } },
    });
    return { saved: false };
  }

  async isCompanySaved(userId: string, slug: string): Promise<boolean> {
    const count = await this.prisma.savedCompany.count({
      where: { userId, company: { slug } },
    });
    return count > 0;
  }

  /**
   * Most recent APPROVED contribution timestamp across all contributable
   * models, or null. Pending and rejected rows never count: otherwise one junk
   * submission would unlock everything for the whole window.
   */
  async lastContributionAt(userId: string): Promise<Date | null> {
    const opts = {
      where: { submittedById: userId, moderationStatus: 'APPROVED' as const },
      orderBy: { createdAt: 'desc' as const },
      select: { createdAt: true },
    };
    const rows = await Promise.all([
      this.prisma.company.findFirst(opts),
      this.prisma.fundingRound.findFirst(opts),
      this.prisma.personRole.findFirst(opts),
      this.prisma.investorHolding.findFirst(opts),
      this.prisma.acquisitionDeal.findFirst(opts),
      this.prisma.exitEvent.findFirst(opts),
      this.prisma.diversitySignal.findFirst(opts),
      this.prisma.changeProposal.findFirst(opts),
    ]);
    const dates = rows
      .map((r) => r?.createdAt)
      .filter((d): d is Date => d instanceof Date);
    if (dates.length === 0) return null;
    return dates.reduce((a, b) => (a > b ? a : b));
  }

  /** PENDING submissions this user has in the moderation queue right now. */
  async countPending(userId: string): Promise<number> {
    const where = { submittedById: userId, moderationStatus: 'PENDING' as const };
    const counts = await Promise.all([
      this.prisma.company.count({ where }),
      this.prisma.fundingRound.count({ where }),
      this.prisma.personRole.count({ where }),
      this.prisma.investorHolding.count({ where }),
      this.prisma.acquisitionDeal.count({ where }),
      this.prisma.exitEvent.count({ where }),
      this.prisma.diversitySignal.count({ where }),
      this.prisma.changeProposal.count({ where }),
    ]);
    return counts.reduce((a, b) => a + b, 0);
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

    const [companies, rounds, people, investors, acquisitions, exits, diversity, proposals] =
      await Promise.all([
        this.prisma.company.findMany({ where, ...order }),
        this.prisma.fundingRound.findMany({ where, ...withCompany }),
        this.prisma.personRole.findMany({ where, ...withCompany }),
        this.prisma.investorHolding.findMany({ where, ...withCompany }),
        this.prisma.acquisitionDeal.findMany({ where, ...withCompany }),
        this.prisma.exitEvent.findMany({ where, ...withCompany }),
        this.prisma.diversitySignal.findMany({ where, ...withCompany }),
        this.prisma.changeProposal.findMany({ where, ...withCompany }),
      ]);

    const items: MyContribution[] = [
      ...companies.map((c) => this.toItem('company', c, { slug: c.slug, name: c.name }, c.name)),
      ...rounds.map((r) => this.toItem('round', r, r.company, `${r.name} round`)),
      ...people.map((p) => this.toItem('person', p, p.company, p.name)),
      ...investors.map((i) => this.toItem('investor', i, i.company, i.name)),
      ...acquisitions.map((a) => this.toItem('acquisition', a, a.company, `Acquired ${a.target}`)),
      ...exits.map((e) => this.toItem('exit', e, e.company, `${e.type} exit`)),
      ...diversity.map((d) => this.toItem('diversity', d, d.company, d.label)),
      ...proposals.map((p) =>
        this.toItem('proposal', p, p.company, `Edit: ${Object.keys(p.changes as object).join(', ')}`),
      ),
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
