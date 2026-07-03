import { Controller, Get } from '@nestjs/common';
import type { InvestorSummary } from '@repo/api';

import { InvestorsService } from './investors.service';

@Controller('investors')
export class InvestorsController {
  constructor(private readonly investors: InvestorsService) {}

  // Public read: unique investors aggregated from approved data.
  @Get()
  findAll(): Promise<InvestorSummary[]> {
    return this.investors.findAll();
  }
}
