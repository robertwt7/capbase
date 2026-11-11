import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CLAIM_ATTEMPTS_PER_COMPANY_PER_DAY,
  CLAIM_ATTEMPTS_PER_USER_PER_DAY,
  CLAIM_CONFIRM_INTERVAL_HOURS,
  CLAIM_COOLDOWN_SECONDS,
  CLAIM_DOMAIN_MISMATCH,
  CLAIM_EMAIL_UNAVAILABLE,
  CLAIM_PAGE_SIZE,
  CLAIM_TOKEN_TTL_HOURS,
  MAX_OPEN_CLAIM_REQUESTS,
  normalizeDomain,
  type AdminClaim,
  type AdminClaimPage,
  type AdminClaimStatusFilter,
  type ClaimMethod,
  type CompanyClaimView,
  type ConfirmClaimResponse,
  type MyCompanyClaim,
  type VerifyClaimResponse,
} from '@repo/api';
import type { Prisma } from '@repo/db';

import { hashToken } from '../auth/mfa/hash';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLIC_COMPANY } from '../prisma/public-filters';
import {
  activeClaimId,
  claimEndReason,
  claimStatus,
  LIVE_CLAIM,
  stampPendingRows,
} from './active-claim';
import { claimableHost, emailMatchesCompany } from './claimable-domain';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Spent and expired tokens are pruned this long after they were issued (on insert). */
const TOKEN_RETENTION_MS = 7 * DAY_MS;

/** Every claim read includes these, so status and the active rule need no second query. */
const CLAIM_INCLUDE = {
  user: { select: { id: true, email: true, name: true, bannedAt: true } },
  company: { select: { slug: true, name: true, domain: true, mergedIntoId: true } },
} as const satisfies Prisma.CompanyClaimInclude;

type ClaimRow = Prisma.CompanyClaimGetPayload<{ include: typeof CLAIM_INCLUDE }>;

const COMPANY_SELECT = { id: true, slug: true, name: true, domain: true, mergedIntoId: true } as const;

/** The owner's view of one claim. The work address is theirs; the company's domain never is. */
export function toMyClaim(row: ClaimRow): MyCompanyClaim {
  return {
    id: row.id,
    companySlug: row.company.slug,
    companyName: row.company.name,
    method: row.method as ClaimMethod,
    status: claimStatus(row, row.company),
    endReason: claimEndReason(row),
    email: row.email,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastConfirmedAt: row.lastConfirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const LINK_INVALID = 'This link is invalid, expired, or already used';

/**
 * Company claims ("this is my company"). A claim is a relationship, never a role and never a
 * reviewable type: nothing here touches `UsersService.accessFor`, the nine contribution tables'
 * moderation status, or the read gate.
 */
@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private siteUrl(): string {
    return this.config.get<string>('SITE_URL', 'http://localhost:3001');
  }

  /** A public company by slug (partner-only included: a claim is not a public read). */
  private async company(slug: string) {
    const company = await this.prisma.company.findFirst({
      where: { slug, ...PUBLIC_COMPANY },
      select: COMPANY_SELECT,
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  // --- The claimant ----------------------------------------------------------

  /** `GET /companies/:slug/claim`: the caller's claims on this company and which flow is
   *  offered. The stored domain is never part of the answer. */
  async view(userId: string, slug: string): Promise<CompanyClaimView> {
    const company = await this.company(slug);
    const rows = await this.prisma.companyClaim.findMany({
      where: { userId, companyId: company.id },
      include: CLAIM_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return {
      company: { slug: company.slug, name: company.name },
      emailClaim: claimableHost(company.domain) !== null,
      claims: rows.map(toMyClaim),
    };
  }

  /**
   * Start an email claim: check the address against the company's domain, the limits, then
   * mint a single-use link to that address. Cheapest checks first; the domain is checked here
   * AND again when the link is spent.
   */
  async startEmail(userId: string, slug: string, email: string): Promise<{ ok: true }> {
    const company = await this.company(slug);
    if (!claimableHost(company.domain)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: CLAIM_EMAIL_UNAVAILABLE,
        message: "This company can't be claimed by email. Send a request for review instead.",
      });
    }
    const address = email.trim().toLowerCase();
    if (!emailMatchesCompany(address, company.domain)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: CLAIM_DOMAIN_MISMATCH,
        message: "That address isn't at this company's domain.",
      });
    }
    if (await activeClaimId(this.prisma, userId, company.id)) {
      throw new ConflictException('You already represent this company.');
    }

    const now = new Date();
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const [newest, userCount, companyCount] = await Promise.all([
      this.prisma.companyClaimToken.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.companyClaimToken.count({ where: { userId, createdAt: { gt: dayAgo } } }),
      this.prisma.companyClaimToken.count({
        where: { companyId: company.id, createdAt: { gt: dayAgo } },
      }),
    ]);
    if (newest && now.getTime() - newest.createdAt.getTime() < CLAIM_COOLDOWN_SECONDS * 1000) {
      throw new HttpException(
        'We sent a link less than a minute ago. Check that inbox and its spam folder.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (userCount >= CLAIM_ATTEMPTS_PER_USER_PER_DAY) {
      throw new HttpException(
        "You've asked for too many claim links today. Try again tomorrow.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (companyCount >= CLAIM_ATTEMPTS_PER_COMPANY_PER_DAY) {
      throw new HttpException(
        'Too many claim links were sent for this company today. Try again tomorrow, or send a request for review.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      // Only the newest link works, but older ones stay: the rows are the attempt counter.
      this.prisma.companyClaimToken.updateMany({
        where: { userId, companyId: company.id, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
      this.prisma.companyClaimToken.create({
        data: {
          userId,
          companyId: company.id,
          email: address,
          domain: normalizeDomain(company.domain),
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + CLAIM_TOKEN_TTL_HOURS * HOUR_MS),
        },
      }),
      this.prisma.companyClaimToken.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - TOKEN_RETENTION_MS) } },
      }),
    ]);
    const link = `${this.siteUrl()}/verify-claim?token=${encodeURIComponent(token)}`;
    void this.mail.sendClaimVerify(address, company.name, link); // never throws
    return { ok: true };
  }

  /**
   * Spend a claim link (public: the token is the credential). The company is re-read and the
   * domain rule re-run against its CURRENT domain, so a company merged or re-domained since
   * the link was sent refuses it.
   */
  async verify(token: string): Promise<VerifyClaimResponse> {
    const row = await this.prisma.companyClaimToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: { select: { id: true, email: true, name: true, bannedAt: true } },
        company: { select: { ...COMPANY_SELECT, moderationStatus: true } },
      },
    });
    const now = new Date();
    if (!row || row.usedAt || row.expiresAt <= now || row.user.bannedAt) {
      throw new BadRequestException(LINK_INVALID);
    }
    const { company, user } = row;
    if (
      company.moderationStatus !== 'APPROVED' ||
      company.mergedIntoId ||
      row.domain !== normalizeDomain(company.domain) ||
      !emailMatchesCompany(row.email, company.domain)
    ) {
      throw new BadRequestException(LINK_INVALID);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const spent = await tx.companyClaimToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
      });
      if (spent.count === 0) throw new BadRequestException(LINK_INVALID);
      const existing = await activeClaimId(tx, user.id, company.id);
      const claimId =
        existing ??
        (
          await tx.companyClaim.create({
            data: {
              userId: user.id,
              companyId: company.id,
              method: 'EMAIL',
              email: row.email,
              domain: row.domain,
              verifiedAt: now,
            },
            select: { id: true },
          })
        ).id;
      await stampPendingRows(tx, user.id, company.id, claimId);
      return existing === null;
    });
    if (created) {
      this.logger.log(`Claim verified: user ${user.id} on company ${company.id} (email)`);
      void this.mail.sendClaimNotice(
        user.email,
        user.name,
        company.name,
        `You're now listed as a verified representative of ${company.name}.`,
      );
    }
    return { companySlug: company.slug, companyName: company.name };
  }

  /** `GET /auth/me/claims`: every claim the caller holds, newest first. */
  async listMine(userId: string): Promise<MyCompanyClaim[]> {
    const rows = await this.prisma.companyClaim.findMany({
      where: { userId },
      include: CLAIM_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toMyClaim);
  }

  /** Withdraw one of the caller's claims (or an undecided request). Another user's id is a 404;
   *  an already-ended claim is returned unchanged. */
  async withdraw(userId: string, id: string): Promise<MyCompanyClaim> {
    const claim = await this.prisma.companyClaim.findFirst({ where: { id, userId } });
    if (!claim) throw new NotFoundException('Claim not found');
    await this.prisma.companyClaim.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: userId, endReason: 'withdrawn' },
    });
    return toMyClaim(await this.load(id));
  }

  /**
   * "These facts are still current": stamps `lastConfirmedAt` on the caller's active claim and
   * nothing else — no Revision, no Company column (so `Company.updatedAt` never moves).
   */
  async confirm(userId: string, slug: string): Promise<ConfirmClaimResponse> {
    const company = await this.company(slug);
    const id = await activeClaimId(this.prisma, userId, company.id);
    if (!id) throw new ForbiddenException("You don't represent this company.");
    const now = new Date();
    const cutoff = new Date(now.getTime() - CLAIM_CONFIRM_INTERVAL_HOURS * HOUR_MS);
    const done = await this.prisma.companyClaim.updateMany({
      where: { id, OR: [{ lastConfirmedAt: null }, { lastConfirmedAt: { lte: cutoff } }] },
      data: { lastConfirmedAt: now },
    });
    if (done.count === 0) {
      throw new HttpException(
        'You already confirmed this profile today.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return { lastConfirmedAt: now.toISOString() };
  }

  /** A manual request: a note and an evidence link an admin decides at `/admin/claims`. */
  async request(
    userId: string,
    slug: string,
    note: string,
    evidenceUrl: string | undefined,
  ): Promise<MyCompanyClaim> {
    const company = await this.company(slug);
    if (await activeClaimId(this.prisma, userId, company.id)) {
      throw new ConflictException('You already represent this company.');
    }
    const open = await this.prisma.companyClaim.findMany({
      where: { userId, method: 'MANUAL', verifiedAt: null, revokedAt: null },
      select: { companyId: true },
    });
    if (open.some((o) => o.companyId === company.id)) {
      throw new ConflictException('You already have a request for this company awaiting review.');
    }
    if (open.length >= MAX_OPEN_CLAIM_REQUESTS) {
      throw new HttpException(
        `You have ${MAX_OPEN_CLAIM_REQUESTS} requests awaiting review. Wait for a decision before sending another.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const created = await this.prisma.companyClaim.create({
      data: {
        userId,
        companyId: company.id,
        method: 'MANUAL',
        note: note.trim(),
        evidenceUrl: evidenceUrl?.trim() || null,
      },
      include: CLAIM_INCLUDE,
    });
    this.logger.log(`Claim request ${created.id}: user ${userId} on company ${company.id}`);
    return toMyClaim(created);
  }

  // --- Admin -----------------------------------------------------------------

  /** One page of claims for `/admin/claims`. Paged by number; never a whole status. */
  async adminList(status: AdminClaimStatusFilter, page: number): Promise<AdminClaimPage> {
    const where = adminStatusWhere(status);
    const pageSize = CLAIM_PAGE_SIZE;
    const [rows, total] = await Promise.all([
      this.prisma.companyClaim.findMany({
        where,
        include: CLAIM_INCLUDE,
        orderBy: [{ createdAt: status === 'pending' ? 'asc' : 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.companyClaim.count({ where }),
    ]);
    return { items: await toAdminClaims(this.prisma, rows), total, page, pageSize };
  }

  /** Open manual requests, for the admin nav. */
  pendingCount(): Promise<number> {
    return this.prisma.companyClaim.count({ where: adminStatusWhere('pending') });
  }

  /** Approve a manual request: it becomes active at once and labels the user's pending rows. */
  async approve(id: string, adminId: string): Promise<AdminClaim> {
    const claim = await this.load(id);
    if (claim.method !== 'MANUAL') throw new BadRequestException('Only a manual request is approved');
    const now = new Date();
    const approved = await this.prisma.$transaction(async (tx) => {
      const done = await tx.companyClaim.updateMany({
        where: { id, verifiedAt: null, revokedAt: null, user: { bannedAt: null } },
        data: { verifiedAt: now, verifiedById: adminId },
      });
      if (done.count === 0) return false;
      await stampPendingRows(tx, claim.userId, claim.companyId, id);
      return true;
    });
    const row = await this.load(id);
    if (approved) {
      this.logger.log(`Claim ${id} approved by ${adminId}`);
      void this.mail.sendClaimNotice(
        row.user.email,
        row.user.name,
        row.company.name,
        `Your request was approved: you're now listed as a verified representative of ${row.company.name}.`,
      );
    }
    return (await toAdminClaims(this.prisma, [row]))[0]!;
  }

  /** Reject a manual request. The optional reason is quoted in the email and never stored. */
  async reject(id: string, adminId: string, note: string | undefined): Promise<AdminClaim> {
    const claim = await this.load(id);
    if (claim.method !== 'MANUAL') throw new BadRequestException('Only a manual request is rejected');
    const done = await this.prisma.companyClaim.updateMany({
      where: { id, verifiedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: adminId, endReason: 'rejected' },
    });
    const row = await this.load(id);
    if (done.count > 0) {
      this.logger.log(`Claim ${id} rejected by ${adminId}`);
      const reason = note?.trim();
      void this.mail.sendClaimNotice(
        row.user.email,
        row.user.name,
        row.company.name,
        `Your request to represent ${row.company.name} wasn't approved.` +
          (reason ? `\nReason: ${reason}` : ''),
      );
    }
    return (await toAdminClaims(this.prisma, [row]))[0]!;
  }

  /** End a claim (any method, any state). */
  async revoke(id: string, adminId: string): Promise<AdminClaim> {
    await this.load(id);
    const done = await this.prisma.companyClaim.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: adminId, endReason: 'revoked' },
    });
    const row = await this.load(id);
    if (done.count > 0) {
      this.logger.log(`Claim ${id} revoked by ${adminId}`);
      void this.mail.sendClaimNotice(
        row.user.email,
        row.user.name,
        row.company.name,
        `A moderator ended your claim: you're no longer listed as a representative of ${row.company.name}.`,
      );
    }
    return (await toAdminClaims(this.prisma, [row]))[0]!;
  }

  private async load(id: string): Promise<ClaimRow> {
    const row = await this.prisma.companyClaim.findUnique({ where: { id }, include: CLAIM_INCLUDE });
    if (!row) throw new NotFoundException('Claim not found');
    return row;
  }
}

/** The `/admin/claims` tabs. `active` includes suspended email claims (still revocable). */
function adminStatusWhere(status: AdminClaimStatusFilter): Prisma.CompanyClaimWhereInput {
  switch (status) {
    case 'pending':
      return { method: 'MANUAL', verifiedAt: null, revokedAt: null, user: { bannedAt: null } };
    case 'active':
      return LIVE_CLAIM;
    case 'ended':
      return { OR: [{ revokedAt: { not: null } }, { user: { bannedAt: { not: null } } }] };
  }
}

/** Admin views of claims, with the deciding admins named in one lookup. */
export async function toAdminClaims(
  db: Prisma.TransactionClient,
  rows: ClaimRow[],
): Promise<AdminClaim[]> {
  const adminIds = [
    ...new Set(rows.flatMap((r) => [r.revokedById, r.verifiedById]).filter((x): x is string => !!x)),
  ];
  const admins = adminIds.length
    ? await db.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } })
    : [];
  const name = new Map(admins.map((a) => [a.id, a.name]));
  return rows.map((r) => ({
    ...toMyClaim(r),
    userId: r.user.id,
    userEmail: r.user.email,
    userName: r.user.name,
    note: r.note,
    evidenceUrl: r.evidenceUrl,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    revokedBy: r.revokedById ? (name.get(r.revokedById) ?? null) : null,
    verifiedBy: r.verifiedById ? (name.get(r.verifiedById) ?? null) : null,
  }));
}

/** Every claim one user holds, as the admin per-user view shows them. */
export async function adminClaimsForUser(
  db: Prisma.TransactionClient,
  userId: string,
): Promise<AdminClaim[]> {
  const rows = await db.companyClaim.findMany({
    where: { userId },
    include: CLAIM_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  return toAdminClaims(db, rows);
}

