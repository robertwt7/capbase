import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PAGE_SIZE,
  type AdminUser,
  type AdminUserListQuery,
  type Paginated,
  type UpdateUserInput,
} from '@repo/api';
import { Prisma } from '@repo/db';

import { PrismaService } from '../../prisma/prisma.service';

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  bannedAt: true,
  createdAt: true,
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
] as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/** The user-moderation half of the admin portal: list, ban, change role. */
@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

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
    const pending = await this.pendingCounts(rows.map((r) => r.id));
    return {
      items: rows.map((r) => this.toAdminUser(r, pending.get(r.id) ?? 0)),
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
   * An admin can't ban or demote themselves: that is how a site ends up with no
   * admin at all.
   */
  async update(id: string, input: UpdateUserInput, actorId: string): Promise<AdminUser> {
    if (input.banned === undefined && input.role === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    if (id === actorId && (input.banned === true || input.role === 'USER')) {
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
      if (banning) await this.rejectPending(tx, id);
      return tx.user.update({ where: { id }, data, select: userSelect });
    });
    const pending = await this.pendingCounts([id]);
    return this.toAdminUser(row, pending.get(id) ?? 0);
  }

  private async rejectPending(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const where = { submittedById: userId, moderationStatus: 'PENDING' as const };
    const data = { moderationStatus: 'REJECTED' as const };
    await Promise.all([
      tx.company.updateMany({ where, data }),
      tx.fundingRound.updateMany({ where, data }),
      tx.personRole.updateMany({ where, data }),
      tx.investorHolding.updateMany({ where, data }),
      tx.acquisitionDeal.updateMany({ where, data }),
      tx.exitEvent.updateMany({ where, data }),
      tx.diversitySignal.updateMany({ where, data }),
      tx.changeProposal.updateMany({ where, data }),
    ]);
  }

  /** PENDING submissions per user across every contributable table, in one query. */
  private async pendingCounts(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const ids = Prisma.join(userIds);
    const branches = CONTRIBUTION_TABLES.map(
      (table) => Prisma.sql`
        SELECT "submittedById" FROM ${Prisma.raw(`"${table}"`)}
        WHERE "moderationStatus" = 'PENDING' AND "submittedById" IN (${ids})`,
    );
    const rows = await this.prisma.$queryRaw<{ id: string; n: number }[]>`
      SELECT "submittedById" AS id, COUNT(*)::int AS n
      FROM (${Prisma.join(branches, ' UNION ALL ')}) pending
      GROUP BY "submittedById"`;
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  private toAdminUser(row: UserRow, pendingCount: number): AdminUser {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      bannedAt: row.bannedAt ? row.bannedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      pendingCount,
    };
  }
}
