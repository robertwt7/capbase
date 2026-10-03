import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ReportQueueResponse } from '@repo/api';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  DismissReportDto,
  ListReportsDto,
  ResolveReportDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

/** The report queue. Its own controller so AdminController doesn't grow
 *  another service dependency; same guards, same `/admin` prefix. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@Query() query: ListReportsDto): Promise<ReportQueueResponse> {
    return this.reports.list(query.status);
  }

  @Post(':id/dismiss')
  dismiss(
    @Param('id') id: string,
    @Body() dto: DismissReportDto,
    @CurrentUser() user: RequestUser,
  ): Promise<{ id: string }> {
    return this.reports.dismiss(id, dto, user.id);
  }

  /** Note + optional link. On a person report, `suppressPerson` also hides the
   *  profile, atomically with closing the report. */
  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @CurrentUser() user: RequestUser,
  ): Promise<{ id: string }> {
    return this.reports.resolve(id, dto, user.id);
  }
}
