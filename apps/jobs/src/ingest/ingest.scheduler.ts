import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { CronJob } from 'cron';

import { IngestLock } from './ingest-lock';
import { IngestService } from './ingest.service';

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
  ) {}

  onApplicationBootstrap(): void {
    const schedule = this.config.get<string>('CRON_SCHEDULE') ?? '0 6 * * *';
    const job = new CronJob(schedule, () => void this.runOnce());
    this.registry.addCronJob('sec-form-d', job);
    job.start();
    this.logger.log(`Scheduled SEC Form D ingest with cron "${schedule}"`);

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
      // SEC-only by default — the Wikidata set changes slowly; re-pull it
      // manually (make ingest SOURCE=WIKIDATA) or via a future monthly schedule.
      const sources = (this.config.get<string>('INGEST_SOURCES') ?? 'SEC_EDGAR')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // A manual backfill may be running in another container; if so, this
      // tick is skipped rather than racing it (IngestLock logs the skip).
      const run = await this.lock.runExclusive('scheduled ingest', () =>
        this.ingest.run({ days, limit, sources }),
      );
      if (run.ran) await this.heartbeat();
    } catch (err) {
      this.logger.error(`Scheduled ingest failed: ${String(err)}`);
      // The cron swallows the error to stay alive, so report it explicitly.
      Sentry.captureException(err, { tags: { ingest: 'scheduled' } });
    } finally {
      this.running = false;
    }
  }

  /** Ping the dead man's switch. Never throws: a monitor that can't be reached
   *  will alert on its own when the ping doesn't arrive. */
  private async heartbeat(): Promise<void> {
    const url = this.config.get<string>('INGEST_HEARTBEAT_URL');
    if (!url) return;
    try {
      const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) });
      if (!res.ok) this.logger.warn(`Ingest heartbeat answered HTTP ${res.status}`);
    } catch (err) {
      this.logger.warn(`Ingest heartbeat failed: ${String(err)}`);
    }
  }
}
