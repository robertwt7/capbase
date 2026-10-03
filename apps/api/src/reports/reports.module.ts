import { Module } from '@nestjs/common';

import { AdminReportsController } from './admin-reports.controller';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
