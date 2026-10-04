import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReviewableType } from '@repo/api';
import * as Sentry from '@sentry/nestjs';
import { CronJob } from 'cron';

import { MailService, type QueueEmailVars } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_QUEUE_ALERT_THRESHOLD = 100;
export const DEFAULT_QUEUE_DIGEST_CRON = '0 8 * * *';
/** How often the threshold is checked. Fixed: "immediate" within ten minutes is plenty
 *  for a queue that one person works through by hand. */
export const QUEUE_CHECK_CRON = '*/10 * * * *';

/** Queue order and names, as the admin emails list them. */
const LABELS: Record<ReviewableType, string> = {
  company: 'New companies',
  round: 'Funding rounds',
  person: 'People',
  investor: 'Investors',
  acquisition: 'Acquisitions',
  exit: 'Exits',
  diversity: 'Diversity signals',
  proposal: 'Edits',
};

export interface QueueStats {
  total: number;
  countsByType: Record<ReviewableType, number>;
  /** When the longest-waiting PENDING row was submitted; null for an empty queue. */
  oldest: Date | null;
}

/**
 * The PENDING queue as counts plus the oldest submission — one aggregate per
 * table, so the ten-minute check never loads the rows `listSubmissions` does.
 */
export async function pendingQueueStats(prisma: PrismaService): Promise<QueueStats> {
  const args = {
    where: { moderationStatus: 'PENDING' as const },
    _count: { _all: true },
    _min: { createdAt: true },
  } as const;
  const [company, round, person, investor, acquisition, exit, diversity, proposal] =
    await Promise.all([
      prisma.company.aggregate(args),
      prisma.fundingRound.aggregate(args),
      prisma.personRole.aggregate(args),
      prisma.investorHolding.aggregate(args),
      prisma.acquisitionDeal.aggregate(args),
      prisma.exitEvent.aggregate(args),
      prisma.diversitySignal.aggregate(args),
      prisma.changeProposal.aggregate(args),
    ]);
  const byType = { company, round, person, investor, acquisition, exit, diversity, proposal };

  const countsByType = Object.fromEntries(
    Object.entries(byType).map(([type, agg]) => [type, agg._count._all]),
  ) as Record<ReviewableType, number>;
  const oldest = Object.values(byType)
    .map((agg) => agg._min.createdAt)
    .filter((d): d is Date => d !== null)
    .reduce<Date | null>((min, d) => (min && min <= d ? min : d), null);
  const total = Object.values(countsByType).reduce((sum, n) => sum + n, 0);
  return { total, countsByType, oldest };
}

/** "under an hour", "19 hours", "3 days". */
export function formatAge(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.floor(hours / 24)} days`;
}

/** The queue as the email placeholders want it: one aligned `label  count` line per
 *  non-empty type (the html body keeps the spacing, in mono). */
export function formatQueue(stats: QueueStats, now: Date): QueueEmailVars {
  const rows = (Object.keys(LABELS) as ReviewableType[])
    .filter((type) => stats.countsByType[type] > 0)
    .map((type) => [LABELS[type], String(stats.countsByType[type])] as const);
  const labelWidth = Math.max(...rows.map(([label]) => label.length)) + 3;
  const countWidth = Math.max(...rows.map(([, count]) => count.length));
  return {
    TOTAL: `${stats.total} submission${stats.total === 1 ? '' : 's'}`,
    BREAKDOWN: rows
      .map(([label, count]) => label.padEnd(labelWidth) + count.padStart(countWidth))
      .join('\n'),
    OLDEST: stats.oldest ? formatAge(now.getTime() - stats.oldest.getTime()) : 'under an hour',
  };
}

/**
 * Tells the admins about the moderation queue, so a backlog comes to the one
 * operator instead of waiting to be noticed:
 *
 * - a **daily digest** (QUEUE_DIGEST_CRON in QUEUE_DIGEST_TZ, default 08:00 UTC),
 *   only when something is pending;
 * - an **immediate alert** when the queue reaches QUEUE_ALERT_THRESHOLD (default
 *   100, `0` turns it off), checked every ten minutes. It fires once, then re-arms
 *   only after the queue drops back below the threshold. The armed state is in
 *   memory, so a restart while the queue is still over the line sends it once more —
 *   a fair nag for a backlog that big.
 *
 * Recipients are every ADMIN account that isn't banned. Mail failures are logged
 * and reported by `MailService`; a failed query is reported here. Neither ever
 * throws into the cron.
 */
@Injectable()
export class QueueAlertsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueAlertsService.name);
  private readonly jobs: CronJob[] = [];
  private readonly threshold: number;
  private readonly digestCron: string;
  private readonly digestTz: string;
  /** False once the threshold alert has gone out, until the queue drops below it. */
  private armed = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    const threshold = config.get<string>('QUEUE_ALERT_THRESHOLD');
    this.threshold = threshold ? Number(threshold) : DEFAULT_QUEUE_ALERT_THRESHOLD;
    this.digestCron = config.get<string>('QUEUE_DIGEST_CRON') || DEFAULT_QUEUE_DIGEST_CRON;
    this.digestTz = config.get<string>('QUEUE_DIGEST_TZ') || 'UTC';
  }

  onApplicationBootstrap(): void {
    this.jobs.push(
      CronJob.from({
        cronTime: this.digestCron,
        timeZone: this.digestTz,
        onTick: () => void this.sendDigest(),
        start: true,
      }),
    );
    let check = 'threshold alert off';
    if (this.threshold > 0) {
      this.jobs.push(
        CronJob.from({
          cronTime: QUEUE_CHECK_CRON,
          onTick: () => void this.checkThreshold(),
          start: true,
        }),
      );
      check = `threshold alert at ${this.threshold}`;
    }
    this.logger.log(`Queue digest "${this.digestCron}" (${this.digestTz}); ${check}`);
  }

  onApplicationShutdown(): void {
    for (const job of this.jobs) job.stop();
  }

  /** Email the digest when anything is pending. Returns whether it went out. */
  async sendDigest(now = new Date()): Promise<boolean> {
    try {
      const stats = await pendingQueueStats(this.prisma);
      if (stats.total === 0) return false;
      const queue = formatQueue(stats, now);
      for (const admin of await this.admins()) {
        await this.mail.sendQueueDigestEmail(admin.email, admin.name, queue);
      }
      return true;
    } catch (err) {
      this.report('queue-digest', err);
      return false;
    }
  }

  /** Email the alert when the queue has just reached the threshold. Returns whether it went out. */
  async checkThreshold(now = new Date()): Promise<boolean> {
    try {
      const stats = await pendingQueueStats(this.prisma);
      if (stats.total < this.threshold) {
        this.armed = true;
        return false;
      }
      if (!this.armed) return false;
      const queue = formatQueue(stats, now);
      for (const admin of await this.admins()) {
        await this.mail.sendQueueAlertEmail(admin.email, admin.name, queue, this.threshold);
      }
      // Only now: a failed lookup above leaves it armed, so the next check retries.
      this.armed = false;
      return true;
    } catch (err) {
      this.report('queue-alert', err);
      return false;
    }
  }

  private admins() {
    return this.prisma.user.findMany({
      where: { role: 'ADMIN', bannedAt: null },
      select: { email: true, name: true },
    });
  }

  private report(job: string, err: unknown): void {
    this.logger.error(`${job} failed`, err instanceof Error ? err.stack : String(err));
    Sentry.captureException(err, { tags: { ops: job } });
  }
}
