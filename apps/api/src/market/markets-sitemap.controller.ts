import { Controller, Get, Query } from '@nestjs/common';
import type { MarketSitemapEntry, SitemapCount } from '@repo/api';

import { SitemapPageDto } from '../prisma/sitemap-page.dto';
import { MarketService } from './market.service';

/** The `markets` sitemap family: indexable vertical pages, `/markets/<sector>/<vertical>`. */
@Controller('markets')
export class MarketsSitemapController {
  constructor(private readonly market: MarketService) {}

  @Get('sitemap')
  sitemap(@Query() query: SitemapPageDto): Promise<MarketSitemapEntry[]> {
    return this.market.sitemap(query.page ?? 0);
  }

  @Get('sitemap/count')
  async sitemapCount(): Promise<SitemapCount> {
    return { count: await this.market.sitemapCount() };
  }
}
