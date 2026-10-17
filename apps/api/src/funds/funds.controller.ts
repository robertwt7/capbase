import { Controller, Get, Param, Query } from '@nestjs/common';
import type { FundDetailResponse, FundSlugEntry, FundSummary, Paginated, SitemapCount } from '@repo/api';

import { FundsService } from './funds.service';
import { SitemapPageDto } from '../prisma/sitemap-page.dto';
import { ListFundsDto } from './dto/list-funds.dto';
import { SearchThrottle } from '../throttle/throttle';

@Controller('funds')
export class FundsController {
  constructor(private readonly funds: FundsService) {}

  /** Public read: one page of approved funds. */
  @SearchThrottle()
  @Get()
  findAll(@Query() query: ListFundsDto): Promise<Paginated<FundSummary>> {
    return this.funds.findAll(query);
  }

  // Declared before @Get(':slug') so the literal path wins over the param route.
  @Get('sitemap')
  sitemap(@Query() query: SitemapPageDto): Promise<FundSlugEntry[]> {
    return this.funds.listSlugs(query.page ?? 0);
  }

  /** Sizes the sitemap index: how many `SITEMAP_PAGE_SIZE` pages to list. */
  @Get('sitemap/count')
  async sitemapCount(): Promise<SitemapCount> {
    return { count: await this.funds.countSlugs() };
  }

  /** The fund page. */
  @SearchThrottle()
  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<FundDetailResponse> {
    return this.funds.findOne(slug);
  }
}
