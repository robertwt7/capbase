import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type {
  CountryFacet,
  InvestorDetailResponse,
  InvestorSlugEntry,
  SitemapCount,
  InvestorSummary,
  Paginated,
} from '@repo/api';

import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { InvestorsService } from './investors.service';
import { SitemapPageDto } from '../prisma/sitemap-page.dto';
import { ListInvestorsDto } from './dto/list-investors.dto';
import { SearchThrottle } from '../throttle/throttle';

@Controller('investors')
export class InvestorsController {
  constructor(private readonly investors: InvestorsService) {}

  // Public read: one page of approved investors. Optional auth: a signed-in
  // viewer also sees partner firms and values.
  @SearchThrottle()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  findAll(
    @Query() query: ListInvestorsDto,
    @CurrentUser() user?: RequestUser,
  ): Promise<Paginated<InvestorSummary>> {
    return this.investors.findAll(query, user);
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

  // Optional auth: the profile is gated per viewer (see InvestorsService.findOne).
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':slug')
  findOne(
    @Param('slug') slug: string,
    @CurrentUser() user?: RequestUser,
  ): Promise<InvestorDetailResponse> {
    return this.investors.findOne(slug, user);
  }
}
