import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { IngestService } from './ingest.service';

/**
 * Registers the recurring SEC Form D ingest. The schedule is read from config
 * (CRON_SCHEDULE) at boot; set INGEST_ON_BOOT=true to also run once on startup.
 */
@Injectable()
export class IngestScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(IngestScheduler.name);
  private running = false;

  constructor(
    private readonly ingest: IngestService,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const schedule = this.config.get<string>('CRON_SCHEDULE') ?? '0 6 * * *';
    const job = new CronJob(schedule, () => void this.runSafe());
    this.registry.addCronJob('sec-form-d', job);
    job.start();
    this.logger.log(`Scheduled SEC Form D ingest with cron "${schedule}"`);

    if (this.config.get<string>('INGEST_ON_BOOT') === 'true') {
      this.logger.log('INGEST_ON_BOOT=true — running an ingest pass now');
      void this.runSafe();
    }
  }

  private async runSafe(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous ingest still running — skipping this tick');
      return;
    }
    this.running = true;
    try {
      const limit = Number(this.config.get<string>('INGEST_LIMIT') ?? '50');
      await this.ingest.run(limit);
    } catch (err) {
      this.logger.error(`Scheduled ingest failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
