import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import { MonitoringService } from './monitoring.service';
@Injectable()
export class MonitoringScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private job?: CronJob;
  private readonly logger = new Logger(MonitoringScheduler.name);
  constructor(
    private readonly config: ConfigService,
    private readonly monitoring: MonitoringService,
  ) {}
  onApplicationBootstrap() {
    if (this.config.get('MONITORING_ENABLED') === 'true')
      this.job = CronJob.from({
        cronTime: this.config.get<string>('MONITORING_CRON', '0 * * * *'),
        timeZone: 'UTC',
        start: true,
        onTick: () =>
          this.monitoring
            .runOnce()
            .catch(() => this.logger.warn('Monitoring evaluation failed')),
      });
  }
  onApplicationShutdown() {
    this.job?.stop();
  }
}
