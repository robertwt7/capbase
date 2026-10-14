import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { CronJob } from 'cron';

import { PrismaService } from '../prisma/prisma.service';
import { runCitationBackfill } from './citation-backfill';
import { IngestLock } from './ingest-lock';
import { IngestService } from './ingest.service';

/** 03:00 on the 10th: after Companies House publishes the month's snapshot
 *  (within five working days of month end), and clear of the 06:00 daily run. */
const DEFAULT_MONTHLY_SCHEDULE = '0 3 10 * *';

/** Comma list → trimmed, non-empty names. */
function sourceList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Registers the recurring SEC Form D ingest. The schedule is read from config
 * (CRON_SCHEDULE) at boot; set INGEST_ON_BOOT=true to also run once on startup.
 *
 * After every run that succeeds it POSTs to INGEST_HEARTBEAT_URL (no-op if
 * unset) — a dead man's switch (healthchecks.io, Better Stack, GlitchTip
 * heartbeat). A failure is already reported to GlitchTip; the heartbeat catches
 * what nothing can report: the cron never firing, the container down, the run
 * hanging. A tick skipped because a manual backfill holds the lock sends no
 * ping either — the data didn't refresh, so the alarm is telling the truth.
 *
 * A second, MONTHLY job refreshes the snapshot sources (MONTHLY_INGEST_SOURCES,
 * e.g. INNOVATE_UK,COMPANIES_HOUSE) on MONTHLY_CRON_SCHEDULE, then re-mints
 * citations in-process — snapshot rows are only traceable once that pass has
 * run. It is DISABLED until MONTHLY_INGEST_SOURCES is set, so deploying this
 * code changes nothing by itself. Both jobs share one `running` flag and the
 * IngestLock, so they never overlap in-process or with a manual backfill. The
 * monthly job pings its own MONTHLY_INGEST_HEARTBEAT_URL.
 */
@Injectable()
export class IngestScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(IngestScheduler.name);
  private running = false;

  constructor(
    private readonly ingest: IngestService,
    private readonly lock: IngestLock,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    const schedule = this.config.get<string>('CRON_SCHEDULE') ?? '0 6 * * *';
    const job = new CronJob(schedule, () => void this.runOnce());
    this.registry.addCronJob('sec-form-d', job);
    job.start();
    this.logger.log(`Scheduled SEC Form D ingest with cron "${schedule}"`);

    const monthly = sourceList(this.config.get<string>('MONTHLY_INGEST_SOURCES'));
    if (monthly.length === 0) {
      this.logger.log('Monthly snapshot ingest disabled (MONTHLY_INGEST_SOURCES is empty)');
    } else {
      const monthlySchedule =
        this.config.get<string>('MONTHLY_CRON_SCHEDULE')?.trim() || DEFAULT_MONTHLY_SCHEDULE;
      let monthlyJob: CronJob;
      try {
        monthlyJob = new CronJob(monthlySchedule, () => void this.runMonthly());
      } catch (err) {
        // Fail boot loudly: a typo here would otherwise silently never run.
        throw new Error(`Invalid MONTHLY_CRON_SCHEDULE "${monthlySchedule}": ${String(err)}`);
      }
      this.registry.addCronJob('monthly-snapshots', monthlyJob);
      monthlyJob.start();
      this.logger.log(
        `Scheduled monthly snapshot ingest [${monthly.join(', ')}] with cron "${monthlySchedule}"`,
      );
    }

    if (this.config.get<string>('INGEST_ON_BOOT') === 'true') {
      this.logger.log('INGEST_ON_BOOT=true — running an ingest pass now');
      void this.runOnce();
    }
  }

  /** One scheduled ingest pass. Never throws — the cron must stay alive. */
  async runOnce(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous ingest still running — skipping this tick');
      return;
    }
    this.running = true;
    try {
      // Small idempotent catch-up window (rides out weekends/holidays).
      const days = Number(this.config.get<string>('INGEST_DAYS') ?? '3');
      const limit = Number(this.config.get<string>('INGEST_LIMIT') ?? '500');
      // SEC-only by default — the snapshot sources run on the monthly job, and
      // Wikidata is re-pulled by hand (make ingest SOURCE=WIKIDATA).
      const sources = sourceList(this.config.get<string>('INGEST_SOURCES') ?? 'SEC_EDGAR');
      // A manual backfill may be running in another container; if so, this
      // tick is skipped rather than racing it (IngestLock logs the skip).
      const run = await this.lock.runExclusive('scheduled ingest', () =>
        this.ingest.run({ days, limit, sources }),
      );
      if (run.ran) await this.heartbeat('INGEST_HEARTBEAT_URL');
    } catch (err) {
      this.logger.error(`Scheduled ingest failed: ${String(err)}`);
      // The cron swallows the error to stay alive, so report it explicitly.
      Sentry.captureException(err, { tags: { ingest: 'scheduled' } });
    } finally {
      this.running = false;
    }
  }

  /**
   * One monthly snapshot pass: the configured sources in order, then the
   * citation backfill. Never throws. `days` is meaningless to snapshot sources
   * and the limit is effectively unbounded — a snapshot is ingested whole.
   */
  async runMonthly(): Promise<void> {
    if (this.running) {
      this.logger.warn('Another ingest still running — skipping this monthly tick');
      return;
    }
    this.running = true;
    try {
      const sources = sourceList(this.config.get<string>('MONTHLY_INGEST_SOURCES'));
      // Sources run in IngestModule registration order (INNOVATE_UK before
      // COMPANIES_HOUSE), whatever order the env lists them in.
      const run = await this.lock.runExclusive('monthly snapshot ingest', async () => {
        const result = await this.ingest.run({ days: 1, limit: 10_000_000, sources });
        await runCitationBackfill(this.prisma);
        return result;
      });
      if (run.ran) await this.heartbeat('MONTHLY_INGEST_HEARTBEAT_URL');
    } catch (err) {
      this.logger.error(`Monthly snapshot ingest failed: ${String(err)}`);
      Sentry.captureException(err, { tags: { ingest: 'monthly' } });
    } finally {
      this.running = false;
    }
  }

  /** Ping a dead man's switch. Never throws: a monitor that can't be reached
   *  will alert on its own when the ping doesn't arrive. */
  private async heartbeat(key: 'INGEST_HEARTBEAT_URL' | 'MONTHLY_INGEST_HEARTBEAT_URL'): Promise<void> {
    const url = this.config.get<string>(key);
    if (!url) return;
    try {
      const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) });
      if (!res.ok) this.logger.warn(`Ingest heartbeat answered HTTP ${res.status}`);
    } catch (err) {
      this.logger.warn(`Ingest heartbeat failed: ${String(err)}`);
    }
  }
}
