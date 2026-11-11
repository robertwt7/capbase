import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import { DigestService } from './digest.service';
@Injectable()
export class DigestScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly jobs: CronJob[] = [];
  private readonly logger = new Logger(DigestScheduler.name);
  constructor(
    private readonly config: ConfigService,
    private readonly digest: DigestService,
  ) {}
  onApplicationBootstrap() {
    if (this.config.get('MONITORING_EMAIL_ENABLED') === 'true') {
      this.jobs.push(
        CronJob.from({
          cronTime: this.config.get<string>(
            'MONITORING_DIGEST_CRON',
            '0 8 * * 1',
          ),
          timeZone: 'UTC',
          start: true,
          onTick: () =>
            this.digest
              .assemble()
              .catch(() => this.logger.warn('Weekly digest assembly failed')),
        }),
      );
      this.jobs.push(
        CronJob.from({
          cronTime: '*/5 * * * *',
          timeZone: 'UTC',
          start: true,
          onTick: () =>
            this.digest
              .dispatch()
              .catch(() => this.logger.warn('Weekly digest dispatch failed')),
        }),
      );
    }
  }
  onApplicationShutdown() {
    for (const job of this.jobs) job.stop();
  }
}
