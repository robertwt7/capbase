import { MailModule } from '../mail/mail.module';
import { DigestService } from './digest.service';
import {
  DigestController,
  DigestUnsubscribeController,
} from './digest.controller';
import { DigestScheduler } from './digest-scheduler.service';
import { Module } from '@nestjs/common';
import { SavedSearchesModule } from '../saved-searches/saved-searches.module';
import { CompaniesModule } from '../companies/companies.module';
import { MonitoringService } from './monitoring.service';
import { UpdatesService } from './updates.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringScheduler } from './monitoring-scheduler.service';
@Module({
  imports: [SavedSearchesModule, CompaniesModule, MailModule],
  controllers: [
    MonitoringController,
    DigestController,
    DigestUnsubscribeController,
  ],
  providers: [
    MonitoringService,
    UpdatesService,
    MonitoringScheduler,
    DigestService,
    DigestScheduler,
  ],
})
export class MonitoringModule {}
