import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { FundDetailResponse, FundSlugEntry, FundSummary, Paginated, SitemapCount } from '@repo/api';

import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { FundsService } from './funds.service';
import { SitemapPageDto } from '../prisma/sitemap-page.dto';
import { ListFundsDto } from './dto/list-funds.dto';
import { SearchThrottle } from '../throttle/throttle';

@Controller('funds')
export class FundsController {
  constructor(private readonly funds: FundsService) {}

  /** Public read: one page of approved funds. Optional auth: a signed-in
   *  viewer also sees partner funds and values. */
  @SearchThrottle()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  findAll(@Query() query: ListFundsDto, @CurrentUser() user?: RequestUser): Promise<Paginated<FundSummary>> {
    return this.funds.findAll(query, user);
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

  /** The fund page, gated per viewer (see FundsService.findOne). */
  @SearchThrottle()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':slug')
  findOne(@Param('slug') slug: string, @CurrentUser() user?: RequestUser): Promise<FundDetailResponse> {
    return this.funds.findOne(slug, user);
  }
}
