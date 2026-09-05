import { Module } from '@nestjs/common';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MergeService } from './merge/merge.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, MergeService],
})
export class AdminModule {}
