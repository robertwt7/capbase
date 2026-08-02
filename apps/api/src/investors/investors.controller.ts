import { Controller, Get, Param, Query } from '@nestjs/common';
import type {
  InvestorDetailResponse,
  InvestorSlugEntry,
  InvestorSummary,
  Paginated,
} from '@repo/api';

import { InvestorsService } from './investors.service';
import { ListInvestorsDto } from './dto/list-investors.dto';

@Controller('investors')
export class InvestorsController {
  constructor(private readonly investors: InvestorsService) {}

  // Public read: one page of approved investors.
  @Get()
  findAll(@Query() query: ListInvestorsDto): Promise<Paginated<InvestorSummary>> {
    return this.investors.findAll(query);
  }

  // Declared before @Get(':slug') so the literal path wins over the param route.
  @Get('sitemap')
  sitemap(): Promise<InvestorSlugEntry[]> {
    return this.investors.listSlugs();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<InvestorDetailResponse> {
    return this.investors.findOne(slug);
  }
}
