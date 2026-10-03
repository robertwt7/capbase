import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { TurnstileGuard } from '../auth/guards/turnstile.guard';
import { CreateReportDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /**
   * "Report an issue". Anonymous by design — a person asking to be removed
   * should never have to sign up — so no JwtAuthGuard and no pending cap:
   * Turnstile here, the nginx `writes` zone (30 r/m per IP) in front.
   */
  @UseGuards(TurnstileGuard)
  @Post()
  create(@Body() dto: CreateReportDto): Promise<{ id: string }> {
    return this.reports.create(dto);
  }
}
