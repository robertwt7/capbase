import { Controller, Get, Query } from '@nestjs/common';
import type { InvestorSummary, Paginated } from '@repo/api';

import { InvestorsService } from './investors.service';
import { ListInvestorsDto } from './dto/list-investors.dto';

@Controller('investors')
export class InvestorsController {
  constructor(private readonly investors: InvestorsService) {}

  // Public read: one page of unique investors aggregated from approved data.
  @Get()
  findAll(@Query() query: ListInvestorsDto): Promise<Paginated<InvestorSummary>> {
    return this.investors.findAll(query);
  }
}
