import { Controller, Get, Param, Query } from '@nestjs/common';
import type {
  CountryFacet,
  InvestorDetailResponse,
  InvestorSlugEntry,
  SitemapCount,
  InvestorSummary,
  Paginated,
} from '@repo/api';

import { InvestorsService } from './investors.service';
import { SitemapPageDto } from '../prisma/sitemap-page.dto';
import { ListInvestorsDto } from './dto/list-investors.dto';
import { SearchThrottle } from '../throttle/throttle';

@Controller('investors')
export class InvestorsController {
  constructor(private readonly investors: InvestorsService) {}

  // Public read: one page of approved investors.
  @SearchThrottle()
  @Get()
  findAll(@Query() query: ListInvestorsDto): Promise<Paginated<InvestorSummary>> {
    return this.investors.findAll(query);
  }

  // Declared before @Get(':slug') so the literal path wins over the param route.
  @Get('countries')
  countries(): Promise<CountryFacet[]> {
    return this.investors.countries();
  }

  // Declared before @Get(':slug') so the literal path wins over the param route.
  @Get('sitemap')
  sitemap(@Query() query: SitemapPageDto): Promise<InvestorSlugEntry[]> {
    return this.investors.listSlugs(query.page ?? 0);
  }

  /** Sizes the sitemap index: how many `SITEMAP_PAGE_SIZE` pages to list. */
  @Get('sitemap/count')
  async sitemapCount(): Promise<SitemapCount> {
    return { count: await this.investors.countSlugs() };
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<InvestorDetailResponse> {
    return this.investors.findOne(slug);
  }
}
