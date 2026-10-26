import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { CronJob } from 'cron';

import { IngestLock } from '../ingest/ingest-lock';
import { readEnrichmentConfig } from './enrichment-config';
import { WebsiteEnrichmentService } from './website-enrichment.service';

@Injectable()
export class EnrichmentScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(EnrichmentScheduler.name);
  private running = false;
  constructor(
    private readonly enrichment: WebsiteEnrichmentService,
    private readonly lock: IngestLock,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const config = readEnrichmentConfig(this.config);
    if (!config.enabled) {
      this.logger.log('Website technology enrichment disabled');
      return;
    }
    if (config.companyIds.length === 0) {
      this.logger.warn('Website technology enrichment has an empty cohort; no targets are eligible');
    }
    const job = new CronJob(config.schedule, () => void this.runOnce(), null, false, 'UTC');
    this.registry.addCronJob('website-technology', job);
    job.start();
    this.logger.log(`Scheduled website technology enrichment in UTC: ${config.schedule}; cohort ${config.companyIds.length}; limit ${config.limit}`);
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    const config = readEnrichmentConfig(this.config);
    if (!config.enabled || config.companyIds.length === 0) return;
    this.running = true;
    try {
      const locked = await this.lock.runExclusive('website technology enrichment', async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('Technology enrichment deadline reached')), config.timeoutMs);
        try {
          const result = await this.enrichment.run({ limit: config.limit, signal: controller.signal });
          if (controller.signal.aborted || result.deadlineReached) throw new Error('Technology enrichment reached its run deadline');
          return result;
        } finally { clearTimeout(timer); }
      });
      if (!locked.ran) return;
      const counters = locked.result;
      this.logger.log(`Website technology batch: ${JSON.stringify(counters)}`);
      // Coverage failures have their own signal, even if every HTTP attempt
      // returned normally. A cron completion heartbeat is not source health.
      const coverage = counters as unknown as { attempted?: number; detected?: number; noDetections?: number; blocked?: number; retryableFailures?: number };
      if ((coverage.attempted ?? 0) > 0 && (coverage.detected ?? 0) + (coverage.noDetections ?? 0) === 0) {
        this.logger.warn('Technology source coverage failure: no usable website responses in this batch');
        Sentry.captureMessage('Technology source coverage failure', { level: 'warning', tags: { enrichment: 'coverage' }, extra: { counters } });
      }
      if (config.heartbeatUrl) {
        try {
          const response = await fetch(config.heartbeatUrl, { method: 'POST', signal: AbortSignal.timeout(10_000) });
          if (!response.ok) this.logger.warn(`Technology heartbeat answered HTTP ${response.status}`);
        } catch (err) { this.logger.warn(`Technology heartbeat failed: ${String(err)}`); }
      }
    } catch (err) {
      this.logger.error(`Website technology enrichment failed: ${String(err)}`);
      Sentry.captureException(err, { tags: { enrichment: 'scheduled' } });
    } finally { this.running = false; }
  }
}
