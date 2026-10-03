import { Module } from '@nestjs/common';

import { PeopleModule } from '../people/people.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MergeService } from './merge/merge.service';
import { AdminUsersService } from './users/admin-users.service';

@Module({
  imports: [PeopleModule],
  controllers: [AdminController],
  providers: [AdminService, MergeService, AdminUsersService],
})
export class AdminModule {}
