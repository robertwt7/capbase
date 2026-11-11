import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FullAccessService, type FullAccess } from '../saved-searches/full-access.guard';
import { GatePolicyService } from '../gate/gate-policy.service';
import { UpdatesService } from './updates.service';
import { MailService } from '../mail/mail.service';
import { loadTemplate, render } from '../mail/templates';
import { renderDigestRows } from '../mail/digest-rows';
import { DIGEST_MAX_AGE_MS, digestRetryDelay } from '../mail/digest-retry';
import { digestUnsubscribeUrl } from './digest-unsubscribe';
import type { MonitorUpdate, ViewerAccess } from '@repo/api';
import type { MonitorDigest } from '@repo/db';
const SEND_BATCH = 10;
const WEEK_MS = 7 * 86400000;
/** One dispatch tick keeps claiming batches for this long (the tick runs every 5 minutes). */
const DISPATCH_BUDGET_MS = 4 * 60000;
/** A row never attempted this long after assembly belongs to a superseded week. */
const UNATTEMPTED_MAX_AGE_MS = WEEK_MS;
/**
 * The digest's identity is the UTC ISO week (Monday 00:00) of the moment it is assembled.
 * The window itself is not tied to a weekday: it runs from the user's previous digest (or
 * opt-in, at most a week back) to the assembly time, so MONITORING_DIGEST_CRON can name any
 * weekly time.
 */
export function digestWeek(now: Date) {
  const weekStart = new Date(now);
  weekStart.setUTCHours(0, 0, 0, 0);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  return { weekStart };
}
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);
  private dispatching = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly fullAccess: FullAccessService,
    private readonly gates: GatePolicyService,
    private readonly updates: UpdatesService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}
  async optIn(userId: string, now = new Date(), known?: FullAccess) {
    const { user } = await this.fullAccess.require(userId, now, known);
    if (!user.emailVerifiedAt)
      throw new BadRequestException(
        'Verify your email before enabling weekly email',
      );
    await this.prisma.user.updateMany({
      where: {
        id: userId,
        email: user.email,
        emailVerifiedAt: { not: null },
        bannedAt: null,
        digestOptInAt: null,
      },
      data: { digestOptInAt: now },
    });
    return { enabled: true };
  }
  async optOut(userId: string) {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { digestOptInAt: null },
    });
    return { enabled: false };
  }
  async assemble(now = new Date()) {
    const { weekStart } = digestWeek(now);
    let after: string | undefined;
    while (true) {
      const users = await this.prisma.user.findMany({
        where: {
          digestOptInAt: { lt: now },
          emailVerifiedAt: { not: null },
          bannedAt: null,
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 100,
      });
      for (const user of users) {
        if (
          await this.prisma.monitorDigest.findUnique({
            where: { userId_weekStart: { userId: user.id, weekStart } },
            select: { id: true },
          })
        )
          continue;
        let access: ViewerAccess;
        try {
          access = (await this.fullAccess.require(user.id, now)).access;
        } catch {
          continue;
        }
        const previous = await this.prisma.monitorDigest.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        // Never more than a week back, so missed weeks never become a backlog.
        const since = new Date(
          Math.max(
            now.getTime() - WEEK_MS,
            user.digestOptInAt!.getTime(),
            previous?.createdAt.getTime() ?? 0,
          ),
        );
        // Newest first, keyset on (observedAt, id): the 50 rows kept are the latest.
        const visible: MonitorUpdate[] = [];
        let cursor: { at: Date; id: string } | undefined;
        while (visible.length < 50) {
          const events = await this.prisma.monitorEvent.findMany({
            where: {
              userId: user.id,
              observedAt: { gte: since, lt: now },
              ...(cursor
                ? {
                    OR: [
                      { observedAt: { lt: cursor.at } },
                      { observedAt: cursor.at, id: { lt: cursor.id } },
                    ],
                  }
                : {}),
            },
            orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
            take: 100,
          });
          if (!events.length) break;
          visible.push(
            ...(
              await this.updates.resolve(
                user.id,
                events,
                access,
                this.gates.current(),
              )
            ).slice(0, 50 - visible.length),
          );
          const last = events[events.length - 1]!;
          cursor = { at: last.observedAt, id: last.id };
          if (events.length < 100) break;
        }
        if (!visible.length) continue;
        const site = this.config.get<string>(
          'SITE_URL',
          'http://localhost:3001',
        );
        const unsubscribe = digestUnsubscribeUrl(
          site,
          this.config.getOrThrow<string>('JWT_SECRET'),
          user.id,
        );
        const payload = render(
          'monitoring-digest',
          loadTemplate('monitoring-digest'),
          {
            ROWS: renderDigestRows(visible, site),
            FEED_URL: new URL('/profile/updates', site).toString(),
            UNSUBSCRIBE_URL: unsubscribe,
          },
        );
        await this.prisma.monitorDigest.createMany({
          data: [
            {
              userId: user.id,
              weekStart,
              ...payload,
              createdAt: now,
              nextAttemptAt: now,
            },
          ],
          skipDuplicates: true,
        });
      }
      if (users.length < 100) break;
      after = users[users.length - 1]!.id;
    }
  }
  /** Sends due digests in batches until none are due or the tick's budget is spent. */
  async dispatch(now = new Date()) {
    if (this.dispatching) return;
    this.dispatching = true;
    const started = Date.now();
    try {
      while (Date.now() - started < DISPATCH_BUDGET_MS) {
        const due = await this.prisma.monitorDigest.findMany({
          where: { status: 'pending', nextAttemptAt: { lte: now } },
          orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
          take: SEND_BATCH,
        });
        if (!due.length) return;
        for (const row of due) await this.dispatchOne(row, now);
      }
    } finally {
      this.dispatching = false;
    }
  }

  private async dispatchOne(row: MonitorDigest, now: Date) {
    const claimed = await this.prisma.monitorDigest.updateMany({
      where: {
        id: row.id,
        status: 'pending',
        nextAttemptAt: row.nextAttemptAt,
        attempts: row.attempts,
      },
      data: { nextAttemptAt: new Date(now.getTime() + 10 * 60000) },
    });
    if (!claimed.count) return;
    let user: Awaited<ReturnType<FullAccessService['require']>>['user'];
    try {
      user = (await this.fullAccess.require(row.userId, now)).user;
    } catch {
      await this.finish(row.id, 'skipped', 'access_unavailable');
      return;
    }
    if (
      !user.digestOptInAt ||
      user.digestOptInAt > row.createdAt ||
      !user.emailVerifiedAt
    ) {
      await this.finish(row.id, 'skipped', 'email_not_eligible');
      return;
    }
    if (
      row.attempts >= 6 ||
      (row.firstAttemptAt &&
        now.getTime() - row.firstAttemptAt.getTime() >= DIGEST_MAX_AGE_MS)
    ) {
      await this.finish(row.id, 'failed', 'retry_limit');
      return;
    }
    if (
      !row.firstAttemptAt &&
      now.getTime() - row.createdAt.getTime() >= UNATTEMPTED_MAX_AGE_MS
    ) {
      await this.finish(row.id, 'skipped', 'superseded');
      return;
    }
    // Persisted before the request: after a crash mid-send the 23 h limit still counts
    // from the real first attempt, inside Resend's 24 h idempotency window.
    const firstAttemptAt = row.firstAttemptAt ?? now;
    if (!row.firstAttemptAt)
      await this.prisma.monitorDigest.update({
        where: { id: row.id },
        data: { firstAttemptAt },
      });
    const site = this.config.get<string>('SITE_URL', 'http://localhost:3001');
    const url = digestUnsubscribeUrl(
      site,
      this.config.getOrThrow<string>('JWT_SECRET'),
      row.userId,
    );
    // Frozen content is deliberate: a later retraction may already be in an attempted message.
    const result = await this.mail.sendDigest(
      user.email,
      { subject: row.subject, html: row.html, text: row.text },
      {
        idempotencyKey: `monitor-digest/${row.id}`,
        headers: {
          'List-Unsubscribe': `<${url}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      },
    );
    const attempts = row.attempts + 1;
    if (result.status === 'sent')
      await this.prisma.monitorDigest.update({
        where: { id: row.id },
        data: {
          status: 'sent',
          attempts,
          providerId: result.providerId,
          sentAt: now,
          lastError: null,
        },
      });
    else if (result.status === 'disabled')
      await this.finish(row.id, 'skipped', 'provider_disabled');
    else if (result.status === 'failed')
      await this.prisma.monitorDigest.update({
        where: { id: row.id },
        data: { status: 'failed', attempts, lastError: result.reason },
      });
    else {
      const delay = digestRetryDelay(attempts, firstAttemptAt, now);
      await this.prisma.monitorDigest.update({
        where: { id: row.id },
        data: {
          status: delay === null ? 'failed' : 'pending',
          attempts,
          lastError: result.reason,
          nextAttemptAt: new Date(now.getTime() + (delay ?? 0)),
        },
      });
    }
  }
  private async finish(id: string, status: string, lastError: string) {
    await this.prisma.monitorDigest.update({
      where: { id },
      data: { status, lastError },
    });
    this.logger.debug(`Monitoring digest ${status}: ${lastError}`);
  }
}
