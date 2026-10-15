import { Module } from '@nestjs/common';

import { ApiKeysModule } from '../api-keys/api-keys.module';
import { MailModule } from '../mail/mail.module';
import { PeopleModule } from '../people/people.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MergeService } from './merge/merge.service';
import { QueueAlertsService } from './queue-alerts.service';
import { AdminUsersService } from './users/admin-users.service';

@Module({
  imports: [MailModule, PeopleModule, ApiKeysModule],
  controllers: [AdminController],
  providers: [AdminService, MergeService, AdminUsersService, QueueAlertsService],
  // The public API's admin keys publish and moderate through the same service.
  exports: [AdminService],
})
export class AdminModule {}
