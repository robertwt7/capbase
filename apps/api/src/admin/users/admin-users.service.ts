import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  type AdminUser,
  type AdminUserDetail,
  type AdminUserListQuery,
  type Paginated,
  type ReviewStatus,
  type UpdateUserInput,
} from '@repo/api';
import { Prisma } from '@repo/db';

import { ApiKeysService } from '../../api-keys/api-keys.service';
import { adminClaimsForUser } from '../../claims/claims.service';
import { SecurityEvent } from '../../auth/mfa/mfa.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  bannedAt: true,
  createdAt: true,
  mfaEnabledAt: true,
} as const;

/** Every table a contributor writes to, i.e. what a moderator reviews. */
const CONTRIBUTION_TABLES = [
  'Company',
  'FundingRound',
  'PersonRole',
  'InvestorHolding',
  'AcquisitionDeal',
  'ExitEvent',
  'DiversitySignal',
  'ChangeProposal',
  'InvestorChangeProposal',
] as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

type ContributionCounts = Record<ReviewStatus, number>;

const NO_CONTRIBUTIONS: ContributionCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };

/** The user-moderation half of the admin portal: list, ban, change role, reset 2FA. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeysService,
    private readonly mail: MailService,
    private readonly usersService: UsersService,
  ) {}

  async list(query: AdminUserListQuery = {}): Promise<Paginated<AdminUser>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const q = query.q?.trim();
    const where: Prisma.UserWhereInput = q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    const ids = rows.map((r) => r.id);
    const [counts, claims] = await Promise.all([
      this.contributionCounts(ids),
      this.claimCounts(ids),
    ]);
    return {
      items: rows.map((r) => this.toAdminUser(r, counts.get(r.id), claims.get(r.id))),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Ban/unban and/or change role. A ban revokes every live session (the
   * tokenVersion bump) and REJECTs everything the user still has PENDING, so a
   * spammer's backlog leaves the queue with them. Unbanning restores access but
   * not the rejected rows. Rejection writes no revisions — nothing went public.
   *
   * A ban, or a role that no longer permits a key's scope, revokes those API keys in
   * the same transaction (USER: all, CONTRIBUTOR: the admin keys).
   *
   * An admin can't ban or demote themselves (to either lower role): that is how a
   * site ends up with no admin at all.
   */
  async update(id: string, input: UpdateUserInput, actorId: string): Promise<AdminUser> {
    if (input.banned === undefined && input.role === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    if (
      id === actorId &&
      (input.banned === true || (input.role !== undefined && input.role !== 'ADMIN'))
    ) {
      throw new BadRequestException("You can't ban or demote your own account");
    }
    const existing = await this.prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!existing) throw new NotFoundException('User not found');

    const banning = input.banned === true && !existing.bannedAt;
    const data: Prisma.UserUpdateInput = {
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.banned === false ? { bannedAt: null } : {}),
      ...(banning ? { bannedAt: new Date(), tokenVersion: { increment: 1 } } : {}),
    };

    const row = await this.prisma.$transaction(async (tx) => {
      if (banning) {
        await this.rejectPending(tx, id, actorId);
        await this.endClaims(tx, id, actorId);
      }
      const updated = await tx.user.update({ where: { id }, data, select: userSelect });
      if (input.role !== undefined || input.banned !== undefined) {
        await this.apiKeys.revokeForRole(tx, id, updated.role, updated.bannedAt !== null);
      }
      return updated;
    });
    const [counts, claims] = await Promise.all([
      this.contributionCounts([id]),
      this.claimCounts([id]),
    ]);
    return this.toAdminUser(row, counts.get(id), claims.get(id));
  }

  /**
   * One account for the moderator's per-user queue: its submissions counted in every
   * status, and the gate state those give it right now (`UsersService.accessFor`, the
   * one definition — so rejecting their only approved row shows as locked here at once).
   */
  async detail(id: string): Promise<AdminUserDetail> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!row) throw new NotFoundException('User not found');
    const [counts, access, claims] = await Promise.all([
      this.contributionCounts([id]),
      this.usersService.accessFor({ id: row.id, role: row.role }),
      adminClaimsForUser(this.prisma, id),
    ]);
    const contributions = counts.get(id) ?? NO_CONTRIBUTIONS;
    return {
      ...this.toAdminUser(row, contributions, claims.length),
      access,
      contributions,
      claims,
    };
  }

  /**
   * The recovery path for a lost device: remove every second factor (authenticator app,
   * passkeys, recovery codes, in-flight challenges) and sign the user out everywhere, then email
   * them. A USER can then sign in with just the password; a role that requires 2FA is sent to
   * forced setup. API keys are kept — enforcement suspends them until the owner re-enrolls.
   * An admin can't reset their own (use the settings page, which asks for the password).
   */
  async resetMfa(id: string, actorId: string): Promise<AdminUser> {
    if (id === actorId) {
      throw new BadRequestException("You can't reset your own two-factor authentication here");
    }
    const existing = await this.prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!existing) throw new NotFoundException('User not found');

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.webAuthnCredential.deleteMany({ where: { userId: id } });
      await tx.recoveryCode.deleteMany({ where: { userId: id } });
      await tx.authChallenge.deleteMany({ where: { userId: id } });
      return tx.user.update({
        where: { id },
        data: {
          totpSecret: null,
          totpEnabledAt: null,
          totpLastStep: null,
          mfaEnabledAt: null,
          tokenVersion: { increment: 1 },
        },
        select: userSelect,
      });
    });
    // After the commit and un-awaited, like every other email: it never fails the reset.
    void this.mail.sendSecurityNotice(row.email, row.name, SecurityEvent.adminReset);
    const [counts, claims] = await Promise.all([
      this.contributionCounts([id]),
      this.claimCounts([id]),
    ]);
    return this.toAdminUser(row, counts.get(id), claims.get(id));
  }

  /** The ban sweep: every PENDING row the user has, REJECTED by the banning admin. */
  private async rejectPending(
    tx: Prisma.TransactionClient,
    userId: string,
    adminUserId: string,
  ): Promise<void> {
    const where = { submittedById: userId, moderationStatus: 'PENDING' as const };
    const data = {
      moderationStatus: 'REJECTED' as const,
      reviewedAt: new Date(),
      reviewedById: adminUserId,
    };
    await Promise.all([
      tx.company.updateMany({ where, data }),
      tx.fundingRound.updateMany({ where, data }),
      tx.personRole.updateMany({ where, data }),
      tx.investorHolding.updateMany({ where, data }),
      tx.acquisitionDeal.updateMany({ where, data }),
      tx.exitEvent.updateMany({ where, data }),
      tx.diversitySignal.updateMany({ where, data }),
      tx.changeProposal.updateMany({ where, data }),
      tx.investorChangeProposal.updateMany({ where, data }),
    ]);
  }

  /**
   * A ban ends every company claim the user holds (pending requests included) and kills their
   * unused claim links. Unbanning restores nothing: a claim is re-made, not resumed.
   */
  private async endClaims(
    tx: Prisma.TransactionClient,
    userId: string,
    adminUserId: string,
  ): Promise<void> {
    const now = new Date();
    await tx.companyClaim.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedById: adminUserId, endReason: 'ban' },
    });
    await tx.companyClaimToken.updateMany({
      where: { userId, usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
  }

  /** Company claims per user, any state (an indexed group on `userId`). */
  private async claimCounts(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.companyClaim.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.userId, r._count._all]));
  }

  /** Submissions per user and status across every contributable table, in one query. */
  private async contributionCounts(userIds: string[]): Promise<Map<string, ContributionCounts>> {
    if (userIds.length === 0) return new Map();
    const ids = Prisma.join(userIds);
    const branches = CONTRIBUTION_TABLES.map(
      (table) => Prisma.sql`
        SELECT "submittedById", "moderationStatus" FROM ${Prisma.raw(`"${table}"`)}
        WHERE "submittedById" IN (${ids})`,
    );
    const rows = await this.prisma.$queryRaw<{ id: string; status: ReviewStatus; n: number }[]>`
      SELECT "submittedById" AS id, "moderationStatus"::text AS status, COUNT(*)::int AS n
      FROM (${Prisma.join(branches, ' UNION ALL ')}) contributions
      GROUP BY "submittedById", "moderationStatus"`;
    const counts = new Map<string, ContributionCounts>();
    for (const r of rows) {
      const user = counts.get(r.id) ?? { ...NO_CONTRIBUTIONS };
      user[r.status] = r.n;
      counts.set(r.id, user);
    }
    return counts;
  }

  private toAdminUser(
    row: UserRow,
    counts: ContributionCounts = NO_CONTRIBUTIONS,
    claimCount = 0,
  ): AdminUser {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      bannedAt: row.bannedAt ? row.bannedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      pendingCount: counts.PENDING,
      approvedCount: counts.APPROVED,
      mfaEnabled: row.mfaEnabledAt !== null,
      claimCount,
    };
  }
}
